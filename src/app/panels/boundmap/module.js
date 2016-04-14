/*
 ## Boundmap module
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

        var module = angular.module('kibana.panels.boundmap', []);
        app.useModule(module);

        module.controller('boundmap', function ($scope, dashboard, querySrv, filterSrv) {
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
                description: 'Bound Box Map'
            };

            // Define panel's default properties and values
            var _d = {
                queries: {
                    mode: 'all',
                    query: '*:*',
                    custom: ''
                },
                field: 'bounds_srpt',
                max_rows: 100,
                fillerpct: 1,
                spyable: true,
                show_queries: true
            };

            // Set panel's default values
            _.defaults($scope.panel, _d);

            $scope.init = function () {
                $scope.$on('refresh', function () {
                    $scope.get_data();
                });

                $scope.get_data();
            };
            $scope.display = {
                info: ""
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

            $scope.get_fq = function () {
                var fq = '';
                if (filterSrv.getSolrFq() && filterSrv.getSolrFq() != '') {
                    fq = '&' + filterSrv.getSolrFq();
                }
                return fq;
            };

            $scope.get_request = function (segment) {

                var request = $scope.sjs.Request().indices(dashboard.indices[segment]);

                $scope.panel_request = request; //panel_request created

                var fq = $scope.get_fq();
                var wt_json = '&wt=json';
                var rows_limit = '&rows=' + $scope.panel.max_rows;
                var start = '&start=0';

                // Set the panel's query
                $scope.panel.queries.basic_query = querySrv.getORquery() + fq;
                $scope.panel.queries.query = $scope.panel.queries.basic_query + wt_json + rows_limit + start;

                // Set the additional custom query
                if ($scope.panel.queries.custom != null) {
                    request = request.setQuery($scope.panel.queries.query + $scope.panel.queries.custom);
                } else {
                    request = request.setQuery($scope.panel.queries.query);
                }

                return request;
            };

            $scope.get_data = function (segment, query_id) {
                $scope.panel.error = false;
                delete $scope.panel.error;

                // Make sure we have everything for the request to complete
                if (dashboard.indices.length === 0) {
                    return;
                }
                $scope.panelMeta.loading = true;
                $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);

                // What this segment is for? => to select which indices to query.
                var _segment = _.isUndefined(segment) ? 0 : segment;
                $scope.segment = _segment;

                $scope.sjs.client.server(dashboard.current.solr.server + dashboard.current.solr.core_name);

                var results = $scope.get_request(_segment).doSearch();


                // Populate scope when we have results
                results.then(function (results) {
                    $scope.panelMeta.loading = false;

                    $scope.handle_response(results, _segment);

                }).catch(
                    function (err) {
                        console.log(err);
                    }
                ).finally(function () {
                    // Hide the spinning wheel icon
                    $scope.panelMeta.loading = false;
                });

            };

            $scope.handle_response = function (results, segment, query_id) {
                if (segment === 0) {
                    $scope.hits = 0;
                    $scope.data = [];
                    query_id = $scope.query_id = new Date().getTime();
                } else {
                    // Fix BUG with wrong total event count.
                    $scope.data = [];
                }

                // Check for error and abort if found
                if (!(_.isUndefined(results.error))) {
                    $scope.panel.error = $scope.parse_error(results.error.msg); // There's also results.error.code
                    return;
                }

                // Check that we're still on the same query, if not stop
                if ($scope.query_id === query_id) {

                    // Solr does not need to accumulate hits count because it can get total count
                    // from a single faceted query.
                    var docs = results.response.docs;
                    angular.forEach(docs, function (item) {
                        console.log(item);
                        $scope.data.push({"wkt": item[$scope.panel.field], "label": item["toponym_ss"][0]});
                    });

                    console.log($scope.data);
                    $scope.renderData();

                } else {
                    return;
                }

                // If we're not sorting in reverse chrono order, query every index for
                // size*pages results
                // Otherwise, only get size*pages results then stop querying
                /*      if (($scope.data.length < $scope.panel.size*$scope.panel.pages ||
                 !((_.contains(filterSrv.timeField(),$scope.panel.sort[0])) && $scope.panel.sort[1] === 'desc')) &&
                 segment+1 < dashboard.indices.length) {
                 $scope.get_data(segment+1,$scope.query_id);
                 }*/

            };


            /*            $scope.get_data = function () {
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
             };*/
        });


        module.directive('boundMap', function () {
            return {

                link: function (scope, elem, attrs) {
                    var map;
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
                        if (typeof scope.dataLayer !== "undefined") {
                            map.removeLayer(scope.dataLayer);
                        }
                        scope.dataLayer = {};
                    };

                    //adapted from MapBox's pointInPolygon plugin
                    scope.pointInBoundingBox = function (p, geojson, first) {
                        p = [p.lng, p.lat];
                        var results = [];
                        var features = geojson.features;
                        for (var i = 0; i < features.length; i++) {
                            if (first && results.length) return;
                            var f = features[i];
                            if (pointInPolyBoundingBox({
                                    type: 'Point',
                                    coordinates: p
                                }, f.geometry.coordinates)) {
                                results.push(f);
                            }
                        }
                        ;
                        return results;
                    };

                    var pointInBoundingBox = function (point, bounds) {
                        //bounds = [minx, miny, maxx, maxy]
                        return !(point.coordinates[0] > bounds[2] || point.coordinates[0] < bounds[0] || point.coordinates[1] > bounds[3] || point.coordinates[1] < bounds[1])
                    };

                    var pointInPolyBoundingBox = function (point, polyBounds) {
                        //polybounds are polygon envelopes: [[minx, miny], [maxx, miny], [maxx, maxy], [minx, maxy], [minx, miny]]
                        var bounds = [polyBounds[0][0][0], polyBounds[0][0][1], polyBounds[0][2][0], polyBounds[0][2][1]];
                        return pointInBoundingBox(point, bounds);
                    };


                    scope.calculateBreaks = function (categories) {
                        var breaks = [];
                        var vals = _.values(scope.data);

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
                        return chroma.scale('Blues').padding([.2, 0]).classes(breaks);
                    };

                    scope.addDataLayer = function () {

                        if (typeof scope.bounds_geojson === "undefined") {
                            return;
                        }

                        /*                        var cats = 6;
                         var breaks = scope.calculateBreaks(cats);
                         if (breaks.length === 0){
                         return;
                         }

                         function getColor(count){
                         return scope.getScale(breaks)(count).hex();
                         }*/


                        function style(feature) {
                            return {
                                weight: 1
                            }
                        }

                        function setText(text) {
                            scope.display.info = text;
                            scope.$digest();
                        }


                        function doCount(e) {
                            var results = scope.pointInBoundingBox(e.latlng, scope.bounds_geojson);
                            var j = 0;
                            _.each(results, function (r) {
                                j += r.properties.count;
                            });
                            var popup = L.popup()
                                .setLatLng(e.latlng)
                                .setContent(j + " projects");
                            map.openPopup(popup);

                        }

                        function onEachFeature(feature, layer) {
                            layer.on({
                                click: doCount
                            });

                        }


                        scope.dataLayer = L.geoJson(scope.bounds_geojson, {
                            style: style,
                            onEachFeature: onEachFeature
                        }).addTo(map);

                        map.fitBounds(scope.dataLayer.getBounds());


                    };


                    function render_panel() {
                        L.Icon.Default.imagePath = 'vendors/leaflet/images';
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
