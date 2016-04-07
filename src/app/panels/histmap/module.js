/*
 ## Histmap module
 * From base tutorial on how to create a custom Banana module.
 */
define([
        'angular',
        'app',
        'underscore',
        'jquery',
        'leaflet',
        'chroma',
        'css!../../../vendor/leaflet/leaflet.css'
    ],
    function (angular, app, _, $, L, chroma) {
        'use strict';

        //$.getScript("app/panels/boundmap/queue.js");

        var module = angular.module('kibana.panels.histmap', []);
        app.useModule(module);

        module.controller('histmap', function ($scope, dashboard, geonamesSrv) {
            $scope.panelMeta = {
                modals: [
                    {
                        description: 'Inspect',
                        icon: 'icon-info-sign',
                        partial: 'app/partials/inspector.html',
                        show: $scope.panel.spyable
                    }
                ],
                editorTabs: [
                    {
                        title: 'Queries',
                        src: 'app/partials/querySelect.html'
                    }
                ],
                status: 'Experimental',
                description: 'Gridded Map'
            };

            // Define panel's default properties and values
            var _d = {
                queries: {
                    mode: 'all',
                    query: '*:*',
                    custom: ''
                },
                field: '',
                max_rows: 100,
                fillerpct: 1,
                spyable: true,
                show_queries: true
            };

            // Set panel's default values
            _.defaults($scope.panel, _d);

            $scope.display = {
                info: ""
            };

            $scope.init = function () {
                $scope.$on('refresh', function () {
                    $scope.get_data();
                });

                $scope.get_data();

            };

            $scope.set_refresh = function (state) {
                $scope.refresh = state;
            };

            $scope.close_edit = function () {
                if ($scope.refresh) {
                    $scope.get_data();
                }
                $scope.refresh = false;
                $scope.render();
            };

            $scope.render = function () {
                $scope.$emit('render');
            };

            $scope.renderData = function () {
                $scope.$emit('renderData');
            };

            $scope.counts = [];
            $scope.bounds_geojson = {};
            $scope.get_data = function () {
                // Show the spinning wheel icon
                $scope.panelMeta.loading = true;

                // Execute the search and get results
                geonamesSrv.getGeoJSON($scope.panel.queries.custom).then(function (data) {
                    $scope.bounds_geojson = data.geojson;
                    $scope.counts = data.values;
                    $scope.renderData();

                }).catch(
                    function (err) {
                        console.log(err);
                    }
                ).finally(function () {
                    // Hide the spinning wheel icon
                    $scope.panelMeta.loading = false;
                });


            };
        });

        module.directive('histMap', function ($timeout) {
            return {

                link: function (scope, elem, attrs) {
                    var map;
                    scope.dataLayers = {};

                    // Receive render events
                    var doRender = function () {
                        if (!_.isUndefined(map)) {
                            map.invalidateSize();
                            map.getPanes();
                        }
                    };

                    scope.$on('render', function () {
                        doRender();
                    });


                    scope.$on('renderData', function () {
                        doRender();
                        scope.refreshData();
                    });

                    scope.refreshData = function () {
                        scope.clearDataLayer();
                        scope.addDataLayer();
                    };


                    scope.clearDataLayer = function () {
                        //data layer can hold multiple grids
                        _.each(scope.dataLayers, function (v, k) {
                            map.removeLayer(v);
                        });
                        scope.dataLayers = {};
                    };

                    scope.calculateBreaks = function (categories) {
                        var breaks = [];
                        var vals = scope.counts;

                        if (vals.length === 0) {
                            return breaks;
                        }

                        var max = _.max(vals);
                        var trimmed = _.without(vals, max);
                        if (trimmed.length === 0) {
                            trimmed = vals;
                        }
                        breaks = chroma.limits(trimmed, 'k', categories);

                        breaks.push(max, max);
                        breaks.unshift(breaks[0]);
                        return breaks;
                    };

                    scope.getScale = function (breaks) {
                        return chroma.scale('OrRd').classes(breaks);
                    };

                    scope.addDataLayer = function () {
                        if (typeof scope.bounds_geojson == "undefined") {
                            return;
                        }

                        var cats = 12;
                        var breaks = scope.calculateBreaks(cats);
                        if (breaks.length === 0) {
                            return;
                        }

                        function getColor(count) {
                            return scope.getScale(breaks)(count).hex();
                        }


                        function style(feature) {
                            return {
                                color: '#000000',
                                weight: .3,
                                fillColor: getColor(feature.properties.count),
                                fillOpacity: .8
                            }
                        }

                        function setText(text) {
                            scope.display.info = text;
                            scope.$digest();

                        }

                        function idFeature(e) {
                            var layer = e.target;
                            var props = layer.feature.properties;
                            setText(props.count + " projects");
                            if (!L.Browser.ie && !L.Browser.opera) {
                                layer.bringToFront();
                            }
                        }

                        function resetFID() {
                            setText("");
                        }


                        function onEachFeature(feature, layer) {
                            layer.on({
                                mouseover: idFeature,
                                mouseout: resetFID
                            });

                        }


                        var size = 3.0;
                        var grid = scope.generateGrid(size);
                        scope.dataLayers[size] = L.geoJson(grid.grid, {
                            style: style,
                            onEachFeature: onEachFeature
                        }).addTo(map);


                    };

                    /*                    function getFill(d) {
                     var c = scope.palatte;
                     // for now, just do equal interval
                     /!*                    var category = Math.round(scope.palatte.length * Math.min(2 * d /Math.max(scope.maxCount, 1), 1)) - 1;
                     if (category < 0){
                     category = 0;
                     }*!/

                     var category = Math.round(d / 5);

                     if (d <= 1) {
                     return {
                     fillColor: '#ffffff',
                     fillOpacity: 0,
                     stroke: false
                     };
                     }
                     if (category >= c.length) {
                     return {
                     fillColor: c[c.length - 1],
                     fillOpacity: .9,
                     weight: .3,
                     color: '#000000'
                     };
                     } else {
                     return {
                     fillColor: c[category],
                     fillOpacity: .65,
                     weight: .3,
                     color: '#000000'
                     };
                     }
                     };

                     function style(feature) {
                     var count = feature.properties.count;
                     return getFill(count);
                     }*/


                    scope.getIntersections = function (bbox) {
                        var count = 0;
                        var features = scope.bounds_geojson.features;
                        for (var i = 0; i < features.length; i++) {
                            var f = features[i];
                            if (polyBboxCollision(bbox, f.geometry.coordinates)) {
                                count += f.properties.count;
                            }
                        }
                        ;
                        return count;
                    };

                    var bboxCollision = function (a, b) {
                        return !( b[0] > a[2] || b[2] < a[0] || b[3] < a[1] || b[1] > a[3]);
                    };


                    var polyBboxCollision = function (point, polyBounds) {
                        //polybounds are polygon envelopes: [[minx, miny], [maxx, miny], [maxx, maxy], [minx, maxy], [minx, miny]]
                        var bounds = [polyBounds[0][0][0], polyBounds[0][0][1], polyBounds[0][2][0], polyBounds[0][2][1]];
                        return bboxCollision(point, bounds);
                    };


                    scope.generateGrid = function (step) {
                        var fc = {
                            "type": "FeatureCollection",
                            "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
                            "features": []
                        };
                        var x = -180.0, miny = -85.0, maxx = 180.0, maxy = 85.0;
                        var y = miny;
                        scope.maxCount = 0;
                        while (x < maxx) {

                            while (y < maxy) {
                                var b = [[[x, y], [x + step, y], [x + step, y + step], [x, y + step], [x, y]]];
                                var c = scope.getIntersections([x, y, x + step, y + step]);
                                scope.maxCount = Math.max(scope.maxCount, c);
                                if (c > 1) {
                                    fc.features.push(getFeature(b, c));
                                }
                                y += step;
                            }

                            x += step;
                            y = miny;
                        }
                        return {
                            grid: fc,
                            maxCount: scope.maxCount
                        };
                    };

                    var getFeature = function (geom, c) {
                        return {
                            "type": "Feature",
                            "geometry": {
                                "type": "Polygon",
                                "coordinates": geom
                            },
                            "properties": {
                                "count": c
                            }
                        };
                    };

                    scope.legend = null;

                    function createLegend() {
                        if (scope.legend !== null) {
                            map.removeControl(scope.legend);
                        }

                        scope.legend = L.control({position: 'bottomright'});

                        scope.legend.onAdd = function (map) {

                            var div = L.DomUtil.create('div', 'info legend'),
                                labels = [];
                            var interval = Math.floor(scope.maxCount / scope.palatte.length);
                            // loop through our density intervals and generate a label with a colored square for each interval
                            for (var i = 0; i < scope.palatte.length; i++) {
                                div.innerHTML +=
                                    '<span class="swatch" style="background:' + scope.palatte[i] + '"></span> ' +
                                    '<span class="interval">' + interval * i + '</span><br>';
                            }

                            return div;
                        };

                        scope.legend.addTo(map);
                    }

                    scope.palatte = ['#ffffcc', '#ffeda0', '#fed976', '#feb24c', '#fd8d3c', '#fc4e2a', '#e31a1c', '#bd0026', '#800026'];


                    scope.maxCount = 1;


                    function render_panel() {
                        //scope.panelMeta.loading = false;
                        L.Icon.Default.imagePath = 'app/panels/histmap/leaflet/images';
                        if (_.isUndefined(map)) {
                            map = L.map(attrs.id, {
                                scrollWheelZoom: true,
                                center: [0, 0],
                                zoom: 1
                            });

                            L.tileLayer('http://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
                                attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="http://cartodb.com/attributions">CartoDB</a>',
                                subdomains: 'abcd',
                                maxZoom: 19
                            }).addTo(map);


                        }

                        return map;
                    };

                    render_panel();

                }

            };
        });
    });
