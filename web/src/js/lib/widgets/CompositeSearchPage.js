/**
 * This is the top-level body page for the search UI.
 */
cinema.views.CompositeSearchPage = Backbone.View.extend({
    events: {
        'click .c-search-filter-apply': function (e) {
            e.preventDefault();
            // TODO apply search filters
        }
    },

    initialize: function (opts) {
        this.visModel = opts.visModel;
        this.layerModel = opts.layerModel;
    },

    render: function () {
        this.$el.html(cinema.templates.compositeSearchPage());

        this.$('[title]').tooltip({
            placement: 'bottom',
            delay: {show: 100}
        });

        this.searchModel = new cinema.models.SearchModel({
            visModel: this.visModel,
            layerModel: this.layerModel
        });

        this.searchModel.on('c:done', this._showResults, this);

        if (this.visModel.loaded()) {
            this.searchModel.compute();
        }

        this.listenTo(this.visModel, 'change', function () {
            renderChildren();
        });

        /*TODO listen to main toolsthis.listenTo(pipelineView.layers, 'change', function () {
            this.searchModel.compute();
        }, this);*/

        var view = this;

        Scrollpoints.add(this.$('.c-search-page-bottom')[0], function () {
            if (view.searchModel.results) {
                view._showNextResult();
            }
        }, {
            when: 'entered',
            once: false
        });
    },

    clearResults: function () {
        this.$('.c-search-results-list-area').empty();
    },

    /** Returns whether we are at the bottom of the page */
    _canScroll: function () {
        return !this.$('.c-search-page-bottom').visible(true);
    },

    _showResults: function () {
        this.resultIndex = 0;
        this.clearResults();
        // The issue is that the this.$el is detached and needs
        // to be re-assign with the setElement method.

        this.$('.c-search-result-message').text(
             this.searchModel.results.length + ' results');

        //this._showNextResult();
    },

    _showNextResult: function () {
        if (this.searchModel.results.length <= this.resultIndex) {
            return;
        }

        var viewpoint = this.searchModel.results[this.resultIndex];
        var el = $(cinema.templates.compositeSearchResultContainer({
            viewpoint: viewpoint
        }));

        el.appendTo(this.$('.c-search-results-list-area'));

        var controlModel = new cinema.models.ControlModel({ info: this.visModel }),
            viewpointModel = new cinema.models.ViewPointModel({ controlModel: controlModel });

        controlModel.setControls(viewpoint);

        new cinema.views.VisualizationCanvasWidget({
            el: el,
            model: this.visModel,
            viewpoint: viewpointModel,
            layers: this.layerModel
        }).on('c:drawn', function () {
            this.resultIndex += 1;

            if (!this._canScroll()) {
                this._showNextResult();
            }
        }, this).render().showViewpoint();
    }
});
