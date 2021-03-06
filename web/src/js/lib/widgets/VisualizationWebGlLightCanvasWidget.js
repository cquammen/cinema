/**
 * This widget renders the visualization defined by a VisualizationModel onto
 * a canvas element that will fill the parent element.
 */
cinema.views.VisualizationWebGlLightCanvasWidget = Backbone.View.extend({
    // Expose primitive events from the canvas for building interactors
    events: {
        'click .c-webgllit-webgl-canvas': function (e) {
            this.trigger('c:click', e);
        },
        'dblclick .c-webgllit-webgl-canvas': function (e) {
            this.trigger('c:dblclick', e);
        },
        'mousedown .c-webgllit-webgl-canvas': function (e) {
            this.trigger('c:mousedown', e);
        },
        'mousemove .c-webgllit-webgl-canvas': function (e) {
            this.trigger('c:mousemove', e);
        },
        'mouseup .c-webgllit-webgl-canvas': function (e) {
            this.trigger('c:mouseup', e);
        },
        'mousewheel .c-webgllit-webgl-canvas': function (e) {
            this.trigger('c:mousewheel', e);
        },
        'DOMMouseScroll .c-webgllit-webgl-canvas': function (e) {
            this.trigger('c:mousewheel', e);
        },
        'keypress .c-webgllit-webgl-canvas': function (e) {
            this.trigger('c:keypress', e);
        },
        'contextmenu .c-webgllit-webgl-canvas': function (e) {
            e.preventDefault();
        }
    },

    //subclass uses to extend
    _privateInit: function (settings) {
        this.lightPosition = [ -1, 1, 0 ];
        this.worldLight = new Vector(-1, 0, 1);
        this.lightTerms = { ka: 0.1, kd: 0.6, ks: 0.3, alpha: 20.0 };
        this.lightColor = [ 1, 1, 1 ];
    },

    /**
     * This widget should be initialized with a visModel as the model parameter
     * and optionally a pre-existing CompositeImageManager.
     *
     * @param model The VisualizationModel being rendered.
     * @param [layers] A LayerModel to use. If none is passed, creates one
     *        internally.
     * @param [compositeManager] A CompositeImageManager to use. If none is
     *        passed, uses the one that is set as the imageManager property of
     *        the visModel. If that is not set, creates one internally.
     */
    initialize: function (settings) {
        this.controlModel = settings.viewpoint.controlModel;
        this.viewpoint = settings.viewpoint;

        if (!this.model.loaded()) {
            this.listenToOnce(this.model, 'change', function () {
                this.initialize(settings);
            });
            return;
        }

        this._privateInit();
        this.compositeModel = settings.model || new cinema.decorators.Composite(this.model);
        this.layers = settings.layers || new cinema.models.LayerModel(this.compositeModel.getDefaultPipelineSetup());
        this.backgroundColor = settings.backgroundColor || '#ffffff';
        this.orderMapping = {};
        this.compositeCache = {};
        this._controls = {};
        this.renderingModel = settings.renderingModel;

        this.lutArrayBuffers = {};
        this.lutArrayViews = {};
        var fieldsList = this.renderingModel.getFields();

        var self = this;
        _.each(fieldsList, function(fieldName) {
            self.lutArrayBuffers[fieldName] = new ArrayBuffer(256*1*4);
            self.lutArrayViews[fieldName] = new Uint8Array(self.lutArrayBuffers[fieldName]);
        });

        this.compositeManager = settings.compositeManager ||
            new cinema.utilities.CompositeImageManager({
                visModel: this.model
            });

        this._computeLayerOffset();
        this._first = true;

        this.avgElapsedMillis = 0.0;
        this.totalElapsedMillis = 0.0;
        this.compositeCount = 0;

        this.listenTo(this.compositeManager, 'c:error', function (e) {
            this.trigger('c:error', e);
        });
        this.listenTo(this.compositeManager, 'c:data.ready', function (data, controls) {
            if (_.isEqual(controls, this._controls)) {
                var startMillis = Date.now();

                this._writeCompositeBuffer(data);
                if (this._first) {
                    this._first = false;
                    this.resetCamera();
                }
                this.drawImage();

                var elapsedMillis = Date.now() - startMillis;
                this.compositeCount += 1;
                this.totalElapsedMillis += elapsedMillis;
                this.averageElapsedMillis = this.totalElapsedMillis / this.compositeCount;

                var curFps = Math.floor((1.0 / elapsedMillis) * 1000);
                var avgFps = Math.floor((1.0 / this.averageElapsedMillis) * 1000);

                cinema.events.trigger('c:fpsupdate', {'curFps': curFps, 'avgFps': avgFps});
            }
        });

        this.listenTo(this.layers, 'change', this.updateQuery);
        this.listenTo(this.renderingModel, 'c:lut-invalid', this.updateLut);
        cinema.bindWindowResizeHandler(this, this.drawImage, 200);

        this.xscale = 1.0;
        this.yscale = 1.0;

        this.webglCompositor = settings.webglCompositor;

        // Generate map of where to find needed sprite offets for each layer
        this._fieldNameMap = {};
        this._lightingFields = [ 'nX', 'nY', 'nZ' ];

        var fieldJson = this.model.attributes.metadata.fields;
        for (var fCode in fieldJson) {
            if (_.has(fieldJson, fCode)) {
                this._fieldNameMap[fieldJson[fCode]] = fCode;
            }
        }

        this._maxOffset = this._calculateMaxOffset();
    },

    render: function () {
        this.$el.html(cinema.templates.webglLightVisCanvas());

        if (this.$('.c-webgllit-webgl-canvas').length > 0) {
            var imgDim = this.compositeModel.getImageSize();

            var vpDim = [
                this.$('.c-webgllit-webgl-canvas').parent().width(),
                this.$('.c-webgllit-webgl-canvas').parent().height()
            ];

            $(this.$('.c-webgllit-webgl-canvas')[0]).attr({
                width: vpDim[0],
                height: vpDim[1]
            });

            this._resizeViewport(vpDim, imgDim);

            this.webglCompositor.init(imgDim,
                                      this.$('.c-webgllit-webgl-canvas')[0]);
        }

        return this;
    },

    _resizeViewport: function (viewportDimensions, imageDimensions) {
        var imgAspect = imageDimensions[0] / imageDimensions[1];
        var vpAspect = viewportDimensions[0] / viewportDimensions[1];

        if (vpAspect > imgAspect) {
            this.naturalZoom = viewportDimensions[1] / imageDimensions[1];
            this.xscale = vpAspect / imgAspect;
            this.yscale = 1.0;
        } else {
            this.naturalZoom = viewportDimensions[0] / imageDimensions[0];
            this.xscale = 1.0;
            this.yscale = imgAspect / vpAspect;
        }
    },

    _computeLayerOffset: function () {
        var query;

        this.layerOffset = {};

        query = this.layers.serialize();
        for (var i = 0; i < query.length; i += 2) {
            var layer = query[i];

            if (query[i + 1] === '_') {
                this.layerOffset[layer] = -1;
            } else {
                this.layerOffset[layer] = this.compositeModel.getSpriteSize() -
                    this.compositeModel.getOffset()[query.substr(i, 2)];
            }
        }
    },

    _spherical2CartesianN: function (phi, theta) {
        var phiRad = (180.0 - phi) * Math.PI / 180.0;
        var thetaRad = (180.0 - theta) * Math.PI / 180.0;
        var x = Math.sin(thetaRad) * Math.cos(phiRad);
        var y = Math.sin(thetaRad) * Math.sin(phiRad);
        var z = Math.cos(thetaRad);
        return [x, y, z];
    },

    _spherical2Cartesian: function (phi, theta) {
        return this._spherical2CartesianN(parseFloat(phi), parseFloat(theta));
    },

    _calculateMaxOffset: function() {
        var offsetMap = this.model.attributes.metadata.offset;
        var maxOffset = 0;
        for (var offKey in offsetMap) {
            if (_.has(offsetMap, offKey)) {
                maxOffset += 1;
            }
        }
        return maxOffset;
    },

    _recomputeLight: function (viewDirection) {
        //construct a coordinate system relative to eye point
        var viewDir = vec3.fromValues(viewDirection[0], viewDirection[1], viewDirection[2]);
        var at = vec3.fromValues(0, 0, 0); //assumption always looking at 0
        var north = vec3.fromValues(0, 0, 1);  //assumption, north is always up
        var approxUp = vec3.create();
        approxUp = vec3.add(approxUp, north, viewDir);
        approxUp = vec3.normalize(approxUp, approxUp);

        var t0 = vec3.create();
        t0 = vec3.subtract(t0, at, viewDir);
        var t1 = vec3.create();
        t1 = vec3.subtract(t1, approxUp, viewDir);
        var right = vec3.create();
        right = vec3.cross(right, t0, t1);
        right = vec3.normalize(right, right);

        t0 = vec3.subtract(t0, right, viewDir);
        t1 = vec3.subtract(t1, at, viewDir);
        var up = vec3.create();
        up = vec3.cross(up, t0, t1);
        up = vec3.normalize(up, up);

        //scale down so we can alway have room before normalization
        var rm = vec3.create();
        rm = vec3.scale(rm, right, this.lightPosition[0] * 0.3);
        var um = vec3.create();
        um = vec3.scale(um, up, this.lightPosition[1] * 0.3);

        var scaledView = vec3.create();
        scaledView = vec3.scale(scaledView, viewDir, 0.3);
        this.worldLight = vec3.add(this.worldLight, scaledView, rm);
        this.worldLight = vec3.add(this.worldLight, this.worldLight, um);
        this.worldLight = vec3.normalize(this.worldLight, this.worldLight);
    },

    setLight: function (_light) {
        if (this.lightPosition !== _light) {
            this.lightPosition = _light;
        }
    },

    updateLut: function(event) {
        var lut = this.renderingModel.getLookupTableForField(event.field);
        this.setLUT(event.field, lut);
    },

    setLUT: function (fieldName, _lut) {
        if (!_.has(this.lutArrayBuffers, fieldName)) {
            this.lutArrayBuffers[fieldName] = new ArrayBuffer(256*1*4);
            this.lutArrayViews[fieldName] = new Uint8Array(this.lutArrayBuffers[fieldName]);
        }
        for (var i = 0; i < 256; i+=1) {
            var idx = i * 4;
            var val = i / 255;
            var color = _lut(val);
            this.lutArrayViews[fieldName][idx] = Math.round(color[0]);
            this.lutArrayViews[fieldName][idx + 1] = Math.round(color[1]);
            this.lutArrayViews[fieldName][idx + 2] = Math.round(color[2]);
            this.lutArrayViews[fieldName][idx + 3] = 1.0;
        }
    },

    setLightColor: function (lightColor) {
        this.lightColor[0] = lightColor[0];
        this.lightColor[1] = lightColor[1];
        this.lightColor[2] = lightColor[2];
    },

    setLightTerms: function (terms) {
        this.lightTerms = terms;
    },

    /**
     * Computes the composite image and writes it into the composite buffer.
     * @param data The payload from the composite image manager c:data.ready
     * callback. This will write computed composite data back into that
     * cache entry so it won't have to recompute it.
     */
    _writeCompositeBuffer: function (data) {

        if (!this.renderingModel.loaded()) {
            console.log("Not ready to render yet.");
            return;
        }

        var compositeCanvas = this.$('.c-webgllit-composite-buffer')[0],
            webglCanvas = this.$('.c-webgllit-webgl-canvas')[0],
            nxCanvas = this.$('.c-webgllit-nx-buffer')[0],
            nyCanvas = this.$('.c-webgllit-ny-buffer')[0],
            nzCanvas = this.$('.c-webgllit-nz-buffer')[0],
            scalarCanvas = this.$('.c-webgllit-scalar-buffer')[0],
            dim = this.compositeModel.getImageSize(),
            spritesheetDim = [ data.image.width, data.image.height ],
            compositeCtx = compositeCanvas.getContext('2d'),
            nxCtx = nxCanvas.getContext('2d'),
            nyCtx = nyCanvas.getContext('2d'),
            nzCtx = nzCanvas.getContext('2d'),
            scalarCtx = scalarCanvas.getContext('2d'),
            composite = this.compositeCache[data.key];

        $(compositeCanvas).attr( { width: dim[0],            height: dim[1] });
        $(nxCanvas).attr(        { width: dim[0],            height: dim[1] });
        $(nyCanvas).attr(        { width: dim[0],            height: dim[1] });
        $(nzCanvas).attr(        { width: dim[0],            height: dim[1] });
        $(scalarCanvas).attr(    { width: dim[0],            height: dim[1] });

        // var idxList = [ this._maxOffset ];
        var idxList = [];
        for (var layerName in this.layerOffset) {
            if (_.has(this.layerOffset, layerName)) {
                // Figure out if this is a "lightable" layer
                var colorByList = this.model.attributes.metadata.layer_fields[layerName];
                var lightableLayer = true;
                var lightingOffsets = {};
                for (var j = 0; j < this._lightingFields.length; j+=1) {
                    if (!_.contains(colorByList, this._fieldNameMap[this._lightingFields[j]])) {
                        lightableLayer = false;
                        break;
                    } else {
                        var offsetCode = layerName + this._fieldNameMap[this._lightingFields[j]];
                        lightingOffsets[this._lightingFields[j]] = this._maxOffset - this.model.attributes.metadata.offset[offsetCode];
                    }
                }

                if (lightableLayer === true) {
                    lightingOffsets.scalar = this.layerOffset[layerName];
                    lightingOffsets.colorBy = this.compositeModel.getFieldName(this.layers.attributes.state[layerName]);
                    idxList.push(lightingOffsets);
                } else {
                    idxList.push(this.layerOffset[layerName]);
                }
            }
        }

        // Clear the fbo for a new round of compositing
        this.webglCompositor.clearFbo();

        var imgw = dim[0], imgh = dim[1];
        var viewDir = this._spherical2Cartesian(this.controlModel.getControl('phi'), this.controlModel.getControl('theta'));
        this._recomputeLight(viewDir);

        // Draw a background pass
        var bgColor = [ 1.0, 1.0, 1.0 ];
        compositeCtx.clearRect(0, 0, imgw, imgh);
        compositeCtx.drawImage(data.image, 0, (this._maxOffset * imgh), imgw, imgh, 0, 0, imgw, imgh);
        this.webglCompositor.drawBackgroundPass(compositeCanvas, bgColor);

        var srcX = 0, srcY = 0;

        for (var i = 0; i < idxList.length; i+=1) {
            if (typeof(idxList[i]) === 'number') {
                //console.log(i);
                var layerIdx = idxList[i];
                srcX = 0;
                srcY = layerIdx * imgh;

                // Because the png has transparency, we need to clear the canvas, or else
                // we end up with some blending when we draw the next image
                compositeCtx.clearRect(0, 0, imgw, imgh);
                compositeCtx.drawImage(data.image, srcX, srcY, imgw, imgh, 0, 0, imgw, imgh);

                this.webglCompositor.drawCompositePass(compositeCanvas);
            } else {
                var lOffMap = idxList[i];
                srcX = 0;
                srcY = 0;

                // Copy the nx buffer
                srcY = lOffMap.nX * imgh;
                nxCtx.clearRect(0, 0, imgw, imgh);
                nxCtx.drawImage(data.image, srcX, srcY, imgw, imgh, 0, 0, imgw, imgh);

                // Copy the ny buffer
                srcY = lOffMap.nY * imgh;
                nyCtx.clearRect(0, 0, imgw, imgh);
                nyCtx.drawImage(data.image, srcX, srcY, imgw, imgh, 0, 0, imgw, imgh);

                // Copy the nz buffer
                srcY = lOffMap.nZ * imgh;
                nzCtx.clearRect(0, 0, imgw, imgh);
                nzCtx.drawImage(data.image, srcX, srcY, imgw, imgh, 0, 0, imgw, imgh);

                // Copy the scalar buffer
                srcY = lOffMap.scalar * imgh;
                scalarCtx.clearRect(0, 0, imgw, imgh);
                scalarCtx.drawImage(data.image, srcX, srcY, imgw, imgh, 0, 0, imgw, imgh);

                this.webglCompositor.drawLitCompositePass(viewDir, this.worldLight, this.lightTerms, this.lightColor,
                                                          nxCanvas, nyCanvas, nzCanvas, scalarCanvas,
                                                          this.lutArrayViews[lOffMap.colorBy]);
            }
        }

        this.trigger('c:composited');
    },

    /**
     * Call this after data has been successfully rendered onto the composite
     * canvas, and it will draw it with the correct scale, zoom, and center
     * onto the render canvas.
     */
    drawImage: function () {
        var webglCanvas = this.$('.c-webgllit-webgl-canvas')[0],
            w = this.$el.width(),
            h = this.$el.height();

        if ( w === 0 && h === 0 ) {
            w = 400;
            h = 400;
        }

        $(webglCanvas).attr({
            width: w,
            height: h
        });

        var zoomLevel = this.viewpoint.get('zoom');
        var drawingCenter = this.viewpoint.get('center');
        zoomLevel = zoomLevel / this.naturalZoom;

        // console.log("drawImage, w = " + w + ", h = " + h + ", zoom: " + zoomLevel + ", center: " + drawingCenter);

        this._resizeViewport([w, h], this.compositeModel.getImageSize());
        this.webglCompositor.resizeViewport(w, h);
        this.webglCompositor.drawDisplayPass(this.xscale / zoomLevel, this.yscale / zoomLevel, drawingCenter);

        this.trigger('c:drawn');
    },

    /**
     * Reset the zoom level and drawing center such that the image is
     * centered and zoomed to fit within the parent container.
     */
    resetCamera: function () {
        var w = this.$el.width(),
            h = this.$el.height(),
            iw = this.$('.c-webgllit-composite-buffer').width(),
            ih = this.$('.c-webgllit-composite-buffer').height();

        this.viewpoint.set({
            zoom: Math.min(w / iw, h / ih),
            center: [w / 2, h / 2]
        });
        return this;
    },

    getImage: function () {
        return this.webglCompositor.getImage();
    },

    /**
     * Change the viewpoint to show a different image.
     * @param viewpoint An object containing "time", "phi", and "theta" keys. If you
     * do not pass this, simply renders the current this.viewpoint value.
     * @return this, for chainability
     */
    showViewpoint: function (forced, controlModel) {
        var changed = false,
            controls = controlModel || this.controlModel.getControls();

        // Search for change
        for (var key in controls) {
            if (_.has(this._controls, key)) {
                if (this._controls[key] !== controls[key]) {
                    changed = true;
                }
            } else {
                changed = true;
            }
        }
        this._controls = _.extend(this._controls, controls);
        if (changed || forced) {
            this.compositeManager.downloadData(this._controls);
        } else {
            this.drawImage();
        }
        return this;
    },

    updateQuery: function (query) {
        this.orderMapping = {};
        this.compositeCache = {};
        this._computeLayerOffset();
        this._controls = {}; // force redraw
        this.showViewpoint();
    },

    updateTheQuery: function (query, viewpoint) {
        this.orderMapping = {};
        this.compositeCache = {};
        this.layerOffset = {};

        for (var i = 0; i < query.length; i += 2) {
            var layer = query[i];

            if (query[i + 1] === '_') {
                this.layerOffset[layer] = -1;
            } else {
                this.layerOffset[layer] = this.compositeModel.getSpriteSize() -
                this.compositeModel.getOffset()[query.substr(i, 2)];
            }
        }
        this.showViewpoint(true, viewpoint);
    },

    forceRedraw: function () {
        this.showViewpoint(true);
    },

    /**
     * Maps an [x, y] value relative to the canvas element to an [x, y] value
     * relative to the image being rendered on the canvas.
     * @param coords 2-length list representing [x, y] offset into the canvas
     * element.
     * @returns the corresponding [x, y] value of the image being rendered on
     * the canvas, respecting zoom level and drawing center, or null if the
     * input coordinates are on a part of the canvas outside of the image render
     * bounds. If not null, this will be a value bounded in each dimension by
     * the length of the composited image in that dimension.
     */
    mapToImageCoordinates: function (coords) {
        // TODO
    }
});
