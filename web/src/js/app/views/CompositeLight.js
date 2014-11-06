cinema.views.CompositeLightView = Backbone.View.extend({
    initialize: function () {
        this.compositeModel = new cinema.decorators.Composite(this.model);
        this.controlModel = new cinema.models.ControlModel({ info: this.model });
        this.viewpointModel = new cinema.models.ViewPointModel({ controlModel: this.controlModel });
        this.layers = new cinema.models.LayerModel(this.compositeModel.getDefaultPipelineSetup(),
            { info: this.model });
        this.renderingModel = new cinema.models.RenderingModel({
            // TODO absolute path...
            url: '/rendering/rendering.json',
            visModel: this.model
        });

        this.listenTo(this.controlModel, 'change', this.refreshCamera);
        this.listenTo(this.viewpointModel, 'change', this.refreshCamera);
        this.listenTo(cinema.events, 'c:resetCamera', this.resetCamera);
    },

    render: function () {
        if (this.renderView) {
            this.renderView.remove();
        }

        this.renderView = new cinema.views.VisualizationCanvasWidgetLight({
            el: this.$('.c-body-container'),
            model: this.compositeModel,
            layers: this.layers,
            controlModel: this.controlModel,
            viewpoint: this.viewpointModel,
            renderingModel: this.renderingModel
        });

        new cinema.utilities.RenderViewMouseInteractor({
            renderView: this.renderView,
            camera: this.viewpointModel
        }).enableMouseWheelZoom({
            maxZoomLevel: 10,
            zoomIncrement: 0.05,
            invertControl: false
        }).enableDragPan({
            keyModifiers: cinema.keyModifiers.SHIFT
        }).enableDragRotation({
            keyModifiers: null
        });
        this.renderView.render();

        if (this.toolsWidget) {
            this.toolsWidget.remove();
        }
        if (this.renderingWidget) {
            this.renderingWidget.remove();
        }
        this.toolsWidget = new cinema.views.CompositeToolsWidget({
            el: this.$('.c-tools-panel'),
            model: this.compositeModel,
            controlModel: this.controlModel,
            viewpoint: this.viewpointModel,
            layers: this.layers,
            toolbarSelector: '.c-panel-toolbar'
        });
        this.renderingWidget = new cinema.views.RenderingWidget({
            el: this.$('.c-rendering-panel'),
            model: this.compositeModel,
            toolbarSelector: '.c-panel-toolbar',
            viewport: this.renderView,
            renderingModel: this.renderingModel
        });
        this.toolsWidget.render();
        this.renderingWidget.render();

        return this;
    },

    refreshCamera: function () {
        if (this.renderView) {
            this.renderView.showViewpoint();
        }
    },

    resetCamera: function () {
        if (this.renderView) {
            this.renderView.showViewpoint();
            this.renderView.resetCamera();
        }
    }
});

cinema.viewMapper.registerView('composite-image-stack-light', 'view', cinema.views.CompositeLightView, {
    controls: [
        { position: 'right', key: 'tools', icon: 'icon-tools', title: 'Tools' },
        { position: 'left', key: 'rendering', icon: 'icon-picture', title: 'Rendering'}
    ]
});
