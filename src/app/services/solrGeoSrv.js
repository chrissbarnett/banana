define([
        'angular',
        'underscore'
    ],
    function (angular, _) {
        'use strict';

        var module = angular.module('kibana.services');

        module.service('solrGeoSrv', function (dashboard, sjsResource, querySrv, filterSrv, $q, indexedDbFactory) {
            //TODO: alter this to transform solr envelopes to geojson

            //should do a couple different things
            // Defaults for query objects
            var _geonames = {
                jsonPath: "app/geojson/bounds.json",
                geonamesSolr: "http://localhost:8983/solr/geonames",
                database: "TestBoundsDatabase",
                version: 1,
                store: "bounds",
                keyPath: "geonameId",
                idField: "PlaceKeywordGeonames"
            };

            // Save a reference to this
            var self = this;

            this.wait = $q.defer();
            this.ready = this.wait.promise;

            this.init = function () {
                _.defaults(dashboard.current.services.geonames, _geonames);

                var db_params = {
                    name: _geonames.database,
                    version: _geonames.version,
                    store: _geonames.store,
                    keyPath: _geonames.keyPath,
                    dataPath: _geonames.jsonPath,
                    indices: [{field: "ids", unique: false}]
                };
                //indexedDbFactory.remove(db_params.name).then(function(){
                self.db = indexedDbFactory.getInstance(db_params);

                self.db.init().then(function () {
                    //the ready promise resolves once the db is ready.
                    self.wait.resolve();
                });
                //});

            };


            /**
             * build the geojson object. returns a promise that resolves on completion. payload is the geojson object.
             *
             * @param custom_query
             * @returns {deferred.promise|{then}}
             */
            this.getGeoJSON = function (custom_query) {
                var deferred = $q.defer();
                this.ready.then(function () {
                    return self._facetSearch(custom_query);
                }).then(function (data) {
                    return self._constructGeoJSON(data);
                }).then(function (data) {
                    return deferred.resolve(data);
                }).catch(function (err) {
                    if (err === "SAME_QUERY") {
                        self.readyForQuery.then(function () {
                            deferred.resolve({
                                geojson: self.bounds_geojson,
                                values: self.counts
                            });
                        });
                    }
                }).finally(function () {
                    //make sure we don't wait forever.
                    //self.waitWhileQuery.resolve();
                });
                return deferred.promise;
            };


            /**
             * converts a bbox of the form [minx, miny, maxx, maxy] to geojson polygon.
             * @param bbox
             * @returns {*[]}
             * @private
             */
            var bboxToCoords = function (bbox) {
                var x1 = bbox[0], y1 = bbox[1], x2 = bbox[2], y2 = bbox[3];
                return [[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]];
            };

            this.bounds_geojson = {
                "type": "FeatureCollection",
                "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
                "features": []
            };

            this.counts = [];

            this.last_query = null;

            /**
             * simple geojson feature template
             * @param count
             * @returns {{type: string, geometry: {type: string, coordinates: Array}, properties: {count: *}}}
             * @private
             */
            var get_feature = function (count) {
                return {
                    "type": "Feature",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": []
                    },
                    "properties": {
                        "count": count
                    }
                };
            };

            /**
             * constructs a facet query to solr that returns a facet list of the form [facetval_i, facetcount_i....]
             *
             * @param facetField
             * @returns {string}
             * @private
             */
            var constructFacetQuery = function (facetField) {
                // Construct Solr query
                var fq = '';
                if (filterSrv.getSolrFq() && filterSrv.getSolrFq() !== '') {
                    fq = '&' + filterSrv.getSolrFq();
                }
                var wt = '&wt=json';
                var facet = '&facet=true&facet.method=fc&facet.field=' + facetField + '&facet.limit=-1&facet.mincount=1';
                var rows_limit = '&rows=0';

                return querySrv.getQuery(0) + fq + facet + wt + rows_limit;
            };

            /**
             * do the facet search
             * @param custom_query
             * @returns {*}
             * @private
             */
            this._facetSearch = function (custom_query) {

                var deferred = $q.defer();

                // Set Solr server
                var sjs = sjsResource(dashboard.get_data_core());

                sjs.client.server(dashboard.get_data_core());

                var request = sjs.Request();

                var query = constructFacetQuery(_geonames.idField);

                // Set the additional custom query
                if (typeof custom_query !== "undefined" && custom_query !== null) {
                    query += custom_query;
                }

                if (query === self.last_query) {
                    deferred.reject("SAME_QUERY");
                } else {

                    self.last_query = query;
                    self.waitWhileQuery = $q.defer();
                    self.readyForQuery = self.waitWhileQuery.promise;
                    // Execute the search and get results
                    var response = request.setQuery(query).doSearch();
                    response.then(function (data) {
                        deferred.resolve(data);
                    });
                }
                return deferred.promise;
            };

            /**
             * takes a facet list of the form [facetval_i, facetcount_i....] and updates the properties (counts) of a
             * geojson object
             *
             * @param facet_results
             */

            /*

             TODO:  instead of looking up in the db, do a solr search on the geonames core.

             */
            this._constructGeoJSON = function (facet_results) {

                var deferred = $q.defer();

                //iterate over facets with counts;
                var facets = facet_results.facet_counts.facet_fields[_geonames.idField];

                self.bounds_geojson.features = [];
                self.counts = [];
                self.geonames_ids = [];
                var len = facets.length;
                _.each(facets, function (el, idx, list) {
                    if (idx % 2 !== 0) {
                        return;
                    }
                    var count = list[idx + 1];
                    self.counts.push(count);
                    self.geonames_ids.push(el);

                    //form an OR solr query to the geonames core


                    /*                    var lookup_callback = function (e) {
                        var db_result = e.target.result;
                        if (typeof db_result !== "undefined") {
                            var feature = get_feature(count);
                            feature.geometry.coordinates.push(bboxToCoords(db_result.bounds));
                            self.bounds_geojson.features.push(feature);
                        }

                        if (idx >= len - 2) {
                            //fulfill the promise
                            deferred.resolve({
                                geojson: self.bounds_geojson,
                                values: self.counts
                            });
                            self.waitWhileQuery.resolve();
                        }
                    };

                    self.db.query(parseInt(el)).then(function (e) {
                        return lookup_callback(e);
                     });*/

                });

                console.log(self.geonames_ids);

                //return a promise
                return deferred.promise;
            };


            self.init();
        });

    });
