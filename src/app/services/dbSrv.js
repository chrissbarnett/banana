define([
        'angular'
    ],
    function (angular) {
        'use strict';

        var module = angular.module('kibana.factories');

        module.factory('indexedDbFactory', function ($q, $http) {

            //should return new instances of an indexedDB wrapper.
            var remove = function (dbname) {
                var deferred = $q.defer();
                var req = window.indexedDB.deleteDatabase(dbname);
                req.onsuccess = function (data) {
                    deferred.resolve(data);
                };
                req.onerror = function (error) {
                    deferred.reject(error);
                };
                return deferred.promise;
            };

            function DbInstance(params) {
                //cursory parameter validation
                var checkIndexParams = function (db_params) {
                    if (!db_params.hasOwnProperty('indices')) {
                        return true;
                    }

                    var wellFormed = false;
                    if (db_params.indices.constructor === Array) {
                        for (var idx in db_params.indices) {
                            var iprops = ['field', 'unique'];
                            for (var p in iprops) {
                                wellFormed = db_params.indices[idx].hasOwnProperty(iprops[p]);
                            }
                        }
                    }

                    return wellFormed;
                };

                var checkParams = function (db_params) {
                    var err = false;
                    var errMsg = "";
                    var props = ['name', 'version', 'store', 'keyPath'];
                    for (var p in props) {
                        if (!db_params.hasOwnProperty(props[p])) {
                            errMsg += "'" + props[p] + "' is a required parameter. ";
                            err = true;
                        }
                    }

                    if (!err && !checkIndexParams(db_params)) {
                        err = true;
                        errMsg += "'indices' is not well-formed. ";
                    }

                    if (err) {
                        throw new Error(errMsg);
                    }

                };

                checkParams(params);

                this.getParams = function () {
                    return params;
                };


                // Save a reference to this
                var self = this;

                this.ready = $q.reject("DB not initialized.");

                this.remove = function () {
                    return remove(params.name);
                };

                /**
                 * Performs a request to open an IndexedDB database. returns a promise that is resolved by the onsuccess
                 * callback. If onupgradeneeded is called, then a chain of promises then we wait for the data store to finish populating
                 * before resolving.
                 *
                 * @returns {deferred.promise|{then}}
                 */
                this.init = function () {
                    var initObj = params;
                    var deferred = $q.defer();
                    var upgradeDeferred = $q.defer();

                    if (!window.indexedDB) {
                        var err = "Your browser doesn't support a stable version of IndexedDB. Some features will not be available.";
                        deferred.reject(err);
                    }

                    // open our database
                    var request = window.indexedDB.open(initObj.name, initObj.version);
                    var upgrade = false;

                    request.onerror = function (e) {
                        // Do something with request.errorCode!
                        console.log("error connecting to database!");
                        deferred.reject(e);
                    };

                    request.onsuccess = function (event) {
                        self.db = event.target.result;
                        if (upgrade) {
                            //we need to wait for the store to populate
                            upgradeDeferred.promise.then(function () {
                                deferred.resolve(event);
                            });
                        } else {
                            deferred.resolve(event);
                        }
                    };

                    request.onupgradeneeded = function (event) {
                        upgrade = true;
                        self.db = event.target.result;

                        /* if (!self.db.objectStoreNames.contains(_geonames.store)) {

                         }*/

                        // Create an objectStore for this database
                        var objectStore = self.db.createObjectStore(initObj.store, {keyPath: initObj.keyPath});

                        for (var idx in initObj.indices) {
                            objectStore.createIndex(idx.field, idx.field, {unique: idx.unique});
                        }

                        // Use transaction oncomplete to make sure the objectStore creation is
                        // finished before adding data into it.
                        objectStore.transaction.oncomplete = function () {
                            //retrieve the data set, populate the object store, then resolve the upgrade deferred object
                            self.populateStore(initObj.store);

                            upgradeDeferred.resolve(true);

                        };
                    };

                    var init_promise = deferred.promise;
                    self.ready = init_promise;
                    return init_promise;
                };


                this.get_solr_query = function (start, rows) {
                    return params.solrCore + "/select?q=*&wt=json&rows=" + rows + "&start=" + start;
                };


                this.populateStore = function (storename) {

                    if (params.hasOwnProperty("dataPath")) {
                        //data is a static json file
                        $http.get(params.dataPath).then(function (r) {
                            self.populateChunk(storename, r.data);
                        });
                    } else if (params.hasOwnProperty("solrCore")) {
                        //data is stored in a solr core. we must iterate over values

                        var rows = 50;
                        var start = 0;
                        var the_data = [];

                        var add_rows = function () {
                            $http.get(self.get_solr_query(start, rows)).then(function (r) {
                                var resp = r.data.response;
                                start = start + rows;
                                var remaining = resp.numFound - start;
                                the_data = resp.docs;
                                self.populateChunk(storename, the_data).then(function () {
                                    if (remaining > 0) {
                                        add_rows();
                                    } else {
                                        //console.log("populateStore finishing");
                                    }

                                });

                            });
                        };

                        add_rows();

                    }

                    return true;
                };

                /**
                 * returns a promise that is resolved once the bounds store is populated. The resolve payload is the onsuccess
                 * event object. reject payloads are onerror event objects
                 *
                 * @param event, storename, array of json objects
                 * @returns {deferred.promise|{then}}
                 * @private
                 */
                this.populateChunk = function (storename, data) {

                    var deferred = $q.defer();
                    // Store values in the newly created objectStore.
                    var boundsObjectStore = self.db.transaction([storename], "readwrite").objectStore(storename);
                    var i = 0;

                    function putNext() {

                        if (i < data.length - 1) {
                            boundsObjectStore.put(data[i]).onsuccess = putNext;
                            boundsObjectStore.put(data[i]).onerror = function (err) {
                                deferred.reject(err);
                            };

                        } else {   // complete
                            boundsObjectStore.put(data[i]).onsuccess = function (e) {
                                deferred.resolve(e);
                            };
                            boundsObjectStore.put(data[i]).onerror = function (err) {
                                deferred.reject(err);
                            };

                        }
                        ++i;
                    }

                    putNext();

                    return deferred.promise;
                };

                /**
                 * query the database. returns a promise that is resolved once the object is retrieved.
                 * @param idx_prop
                 * @param store$ (optional)
                 *
                 * @returns {deferred.promise|{then}}
                 */
                this.query = function (idx_prop, store$) {
                    if (typeof store$ === "undefined") {
                        store$ = params.store;
                    }
                    var deferred = $q.defer();
                    var boundsStore = self.db.transaction(store$, "readonly").objectStore(store$);
                    var req = boundsStore.get(idx_prop);
                    req.onsuccess = function (data) {
                        deferred.resolve(data);
                    };
                    req.onerror = function (error) {
                        deferred.reject(error);
                    };

                    return deferred.promise;
                };


            }

            return {
                getInstance: function (params) {
                    return new DbInstance(params);
                },
                remove: remove
            };
        });


    });
