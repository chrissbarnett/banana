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

        var module = angular.module('kibana.panels.histmap', []);
        app.useModule(module);

        module.controller('histmap', function ($scope, dashboard, solrGeoSrv) {
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
                solrGeoSrv.getGeoJSON($scope.panel.queries.custom).then(function (data) {
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


                    scope.getIntersections = function (bbox) {
                        var count = 0;
                        var features = scope.bounds_geojson.features;
                        for (var i = 0; i < features.length; i++) {
                            var f = features[i];

                            if (polyBboxCollision(bbox, f.geometry.coordinates)) {
                                count += f.properties.count;
                            }
                        }
                        return count;
                    };

                    var bboxCollision = function (a, b) {
                        return !( b[0] > a[2] || b[2] < a[0] || b[3] < a[1] || b[1] > a[3]);
                    };


                    var polyBboxCollision = function (bbox, polyBounds) {

                        //polybounds are polygon envelopes: [[minx, miny], [maxx, miny], [maxx, maxy], [minx, maxy], [minx, miny]]
                        var bounds = [polyBounds[0][0][0], polyBounds[0][0][1], polyBounds[0][2][0], polyBounds[0][2][1]];
                        return bboxCollision(bbox, bounds);
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


                    scope.maxCount = 1;


                    function render_panel() {
                        L.Icon.Default.imagePath = 'vendors/leaflet/images';


                        var globalControl = L.Control.extend({
                            options: {
                                position: 'topleft'
                                //control position - allowed: 'topleft', 'topright', 'bottomleft', 'bottomright'
                            },

                            onAdd: function (map) {
                                var container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');

                                container.style.backgroundColor = 'white';
                                container.style.width = '26px';
                                container.style.height = '26px';

                                var label = L.DomUtil.create('span', 'icon-globe');
                                //color: black; font-size: 22px; line-height: 26px; margin-left: 3px
                                label.style.color = '#555';
                                label.style.fontSize = '22px';
                                label.style.marginLeft = '3px';
                                label.style.lineHeight = '26px';

                                container.appendChild(label);

                                container.onclick = function () {
                                    //we're more interested in roughly fitting the width of the world
                                    map.fitBounds([
                                        [-30, -170],
                                        [30, 170]
                                    ]);
                                }
                                return container;
                            }

                        });



                        if (_.isUndefined(map)) {
                            map = L.map(elem[0], {
                                scrollWheelZoom: true,
                                center: [0, 0],
                                zoom: 1,
                                worldCopyJump: true
                            });


                            var https = 'https://cartodb-basemaps-{s}.global.ssl.fastly.net/{basemap-name}/{z}/{x}/{y}.png';


                            L.tileLayer('http://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
                                attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="http://cartodb.com/attributions">CartoDB</a>',
                                subdomains: 'abcd',
                                maxZoom: 19
                            }).addTo(map);

                            map.addControl(new globalControl());


                        }

                        return map;
                    };

                    render_panel();

                }

            };
        });
    });
