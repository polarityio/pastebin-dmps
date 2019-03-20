'use strict';

let request = require('request');
let _ = require('lodash');
let async = require('async');
let config = require('./config/config');
let fs = require('fs');

let Logger;
let requestWithDefaults;
let previousDomainRegexAsString = '';
let previousEmailRegexAsString = '';
let domainBlacklistRegex = null;
let emailBlacklistRegex = null;

function _setupRegexBlacklists(options) {
    if (options.domainBlacklistRegex !== previousDomainRegexAsString && options.domainBlacklistRegex.length === 0) {
        Logger.debug("Removing Domain Blacklist Regex Filtering");
        previousDomainRegexAsString = '';
        domainBlacklistRegex = null;
    } else {
        if (options.domainBlacklistRegex !== previousDomainRegexAsString) {
            previousDomainRegexAsString = options.domainBlacklistRegex;
            Logger.debug({domainBlacklistRegex: previousDomainRegexAsString}, "Modifying Domain Blacklist Regex");
            domainBlacklistRegex = new RegExp(options.domainBlacklistRegex, 'i');
        }
    }

    if (options.emailBlacklistRegex !== previousEmailRegexAsString && options.emailBlacklistRegex.length === 0) {
        Logger.debug("Removing Email Blacklist Regex Filtering");
        previousEmailRegexAsString = '';
        emailBlacklistRegex = null;
    } else {
        if (options.emailBlacklistRegex !== previousEmailRegexAsString) {
            previousEmailRegexAsString = options.emailBlacklistRegex;
            Logger.debug({emailBlacklistRegex: previousEmailRegexAsString}, "Modifying Email Blacklist Regex");
            emailBlacklistRegex = new RegExp(options.emailBlacklistRegex, 'i');
        }
    }
}

function doLookup(entities, options, cb) {
    let blacklist = options.blacklist;
    let lookupResults = [];

    _setupRegexBlacklists(options);

    Logger.trace({blacklist: blacklist}, "checking to see what blacklist looks like");

    async.each(entities, function (entityObj, next) {
        if (_.includes(blacklist, entityObj.value)) {
            next(null);
        } else if (entityObj.isEmail) {
            if (emailBlacklistRegex !== null) {
                if (emailBlacklistRegex.test(entityObj.value)) {
                    Logger.debug({email: entityObj.value}, 'Blocked BlackListed Email Lookup');
                    return next(null);
                }
            }
            _lookupEntity(entityObj, options, function (err, result) {
                if (err) {
                    next(err);
                } else {
                    lookupResults.push(result);
                    Logger.debug({result: result}, "Checking the result values ");
                    next(null);
                }
            });
        } else if (entityObj.isDomain) {
            if (domainBlacklistRegex !== null) {
                if (domainBlacklistRegex.test(entityObj.value)) {
                    Logger.debug({domain: entityObj.value}, 'Blocked BlackListed Domain Lookup');
                    return next(null);
                }
            }
            _lookupEntityDomain(entityObj, options, function (err, result) {
                if (err) {
                    next(err);
                } else {
                    lookupResults.push(result);
                    Logger.debug({result: result}, "Checking the result values ");
                    next(null);
                }
            });
        } else {
            next(null);
        }
    }, function (err) {
        cb(err, lookupResults);
    });
}


function _lookupEntity(entityObj, options, cb) {

    let requestOptions = {
        uri: options.baseUrl + '/api/search/' + entityObj.value,
        method: 'GET',
        json: true
    };

    requestWithDefaults(requestOptions, function (err, response, body) {
        let errorObject = _isApiError(err, response, body, entityObj.value);
        if (errorObject) {
            cb(errorObject);
            return;
        }

        if (_isLookupMiss(response)) {
            cb(null, {
                entity: entityObj,
                data: null
            });
            return;
        }
        Logger.debug({body: body}, "Printing out the results of Body ");

        Logger.debug({body: body}, "Checking Null issues for body");

        if (_.isNull(body) || _.isEmpty(body.data || body.count === 0)){
          cb(null, {
            entity: entityObj,
            data: null // setting data to null indicates to the server that this entity lookup was a "miss"
          });
          return;
        }

        // The lookup results returned is an array of lookup objects with the following format
        cb(null, {
            // Required: This is the entity object passed into the integration doLookup method
            entity: entityObj,
            // Required: An object containing everything you want passed to the template
            data: {
                // Required: These are the tags that are displayed in your template
                summary: ["Total Pastebin Dumps: " + body.count],
                // Data that you want to pass back to the notification window details block
                details: body.data
            }
        });
    });
}

function _lookupEntityDomain(entityObj, options, cb) {

    let requestOptions = {
        uri: options.baseUrl + '/api/search/' + entityObj.value,
        method: 'GET',
        json: true
    };

    requestWithDefaults(requestOptions, function (err, response, body) {
        let errorObject = _isApiError(err, response, body, entityObj.value);
        if (errorObject) {
            cb(errorObject);
            return;
        }

        if (_isLookupMiss(response)) {
            cb(null, {
                entity: entityObj,
                data: null
            });
            return;
        }
        Logger.debug({body: body}, "Printing out the results of Body ");

        Logger.debug({body: body}, "Checking Null issues for body");

        if (_.isNull(body) || _.isEmpty(body.data || body.count === 0)){
          cb(null, {
            entity: entityObj,
            data: null // setting data to null indicates to the server that this entity lookup was a "miss"
          });
          return;
        }

        // The lookup results returned is an array of lookup objects with the following format
        cb(null, {
            // Required: This is the entity object passed into the integration doLookup method
            entity: entityObj,
            // Required: An object containing everything you want passed to the template
            data: {
                // Required: These are the tags that are displayed in your template
                summary: ["Total Pastebin Dumps: " + body.count],
                // Data that you want to pass back to the notification window details block
                details: body.data
            }
        });
    });
}

function _isLookupMiss(response) {
    return response.statusCode === 404 || response.statusCode === 500 || response.statusCode === 400;
}

function _isApiError(err, response, body, entityValue) {
    if (err) {
        return {
            detail: 'Error executing HTTP request',
            error: err
        };
    }

    if (response.statusCode === 500) {
        return _createJsonErrorPayload("Server 500 error", null, '500', '1', 'Server 500 error', {
            err: err,
            entityValue: entityValue
        });
    }

    // Any code that is not 200 and not 404 (missed response) or 400, we treat as an error
    if (response.statusCode !== 200 && response.statusCode !== 404 && response.statusCode !== 400) {
        return _createJsonErrorPayload("Unexpected HTTP Status Code", null, response.statusCode, '1', 'Unexpected HTTP Status Code', {
            err: err,
            body:body,
            entityValue: entityValue
        });
    }

    return null;
}

function validateOptions(userOptions, cb) {
    let errors = [];

    if(typeof userOptions.domainBlacklistRegex.value === 'string' && userOptions.domainBlacklistRegex.value.length > 0){
        try{
            new RegExp(userOptions.domainBlacklistRegex.value);
        }
        catch(error){
            errors.push({
                key: 'domainBlacklistRegex',
                message: error.toString()
            });
        }
    }

    if(typeof userOptions.emailBlacklistRegex.value === 'string' && userOptions.emailBlacklistRegex.value.length > 0){
        try{
            new RegExp(userOptions.emailBlacklistRegex.value);
        }
        catch(e){
            errors.push({
                key: 'emailBlacklistRegex',
                message: error.toString()
            });
        }
    }

    cb(null, errors);
}

function startup(logger) {
    Logger = logger;
    let defaults = {};

    if (typeof config.request.cert === 'string' && config.request.cert.length > 0) {
        defaults.cert = fs.readFileSync(config.request.cert);
    }

    if (typeof config.request.key === 'string' && config.request.key.length > 0) {
        defaults.key = fs.readFileSync(config.request.key);
    }

    if (typeof config.request.passphrase === 'string' && config.request.passphrase.length > 0) {
        defaults.passphrase = config.request.passphrase;
    }

    if (typeof config.request.ca === 'string' && config.request.ca.length > 0) {
        defaults.ca = fs.readFileSync(config.request.ca);
    }

    if (typeof config.request.proxy === 'string' && config.request.proxy.length > 0) {
        defaults.proxy = config.request.proxy;
    }

    requestWithDefaults = request.defaults(defaults);
}

module.exports = {
    doLookup: doLookup,
    startup: startup,
    validateOptions: validateOptions
};
