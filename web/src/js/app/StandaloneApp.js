cinema.StandaloneApp = Backbone.View.extend({
    events: {
        // Handle control panel close action
        'click .c-control-panel-header .panel-close': function (e) {
            $(e.currentTarget).parents('.c-control-panel').fadeOut();
        },

        // Handle control panel toggle visibility action
        'click .c-visibility-button': function (e) {
            var origin = $(e.target),
                panel = $('.' + origin.attr('container-class'));
            panel.fadeToggle();
            cinema.events.trigger('toggle-control-panel', { panel: panel, key: panel.attr('key') });
        },

        // Handle search navigation
        'click .c-search-filter-apply': function (e) {
            cinema.router.navigate('#search', { trigger: true });
        },

        'click .c-app-icon': function (e) {
            cinema.router.navigate('#view', { trigger: true });
        },

        'keyup .c-search-filter': function (e) {
            if (e.keyCode === 13) {
                var searchQuery = $(e.currentTarget).val();
                cinema.events.trigger('c:handlesearchquery', {searchQuery: searchQuery});
            }
        }
    },

    initialize: function (settings) {
        this.dataRoot = settings.dataRoot;
        this.staticRoot = settings.staticRoot;

        // When additional view type are added just expand the given list
        this.allowedViewType = ['view', 'search'];

        this.model = new cinema.models.VisualizationModel({
            basePath: this.dataRoot,
            infoFile: 'info.json'
        });
        cinema.model = this.model;

        Backbone.history.start({
            pushState: false
        });

        this.listenTo(this.model, 'change', this.render);
        this.model.fetch();
    },

    render: function () {
        if (!this.model.loaded()) {
            return;
        }

        // Make sure we have a view type valid
        if (cinema.viewType === null || cinema.viewType === undefined || cinema.viewType === '' || !_.contains(this.allowedViewType, cinema.viewType)) {
            cinema.viewType = 'view';
        }

        // Find out what the view control list is for control panel container
        var controlList = cinema.viewFactory.getViewControlList('body', cinema.viewType, cinema.model);

        // Create container for control panels
        this.$el.html(cinema.app.templates.layout({controlList:controlList, viewType:cinema.viewType}));

        // Handle header bar base on application type (workbench/cinema)
        if (cinema.model.getDataType() === 'workbench') {
            // Workbench Cinema App
            this.$('.header-left').html(cinema.app.templates.headerLeft({icon: 'icon-cinema', title: 'Workbench', active: cinema.viewType}));
            this.$('.header-right').html(cinema.app.templates.workbenchControl({
                runs: cinema.model.get('runs')
            }));
        } else {
            // Single Cinema App
            this.$('.header-left').html(cinema.app.templates.headerLeft({icon: 'icon-cinema', title: 'Cinema', active: cinema.viewType}));
            this.$('.header-center').html(cinema.app.templates.cinemaSearch());
            this.$('.header-right').html(cinema.app.templates.cinemaControl({controlList:controlList}));
        }

        // Fill the layout base on the type of the view and model.
        cinema.viewFactory.render('body', cinema.viewType, cinema.model);

        // Create nice tooltip for the full page
        this.$('[title]').tooltip({
            placement: 'bottom',
            delay: {show: 200}
        });

        return this;
    }
});
