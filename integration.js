'use strict';

let request = require('request');
let _ = require('lodash');
let fp = require('lodash/fp');
let async = require('async');
let moment = require('moment');
let config = require('./config/config');
let fs = require('fs');

let Logger;
let requestWithDefaults;
let previousDomainRegexAsString = '';
let previousEmailRegexAsString = '';
let domainBlocklistRegex = null;
let emailBlocklistRegex = null;
let DAYS_TO_LOOK_BACK = 60;

function _setupRegexBlocklists(options) {
    if (options.domainBlocklistRegex !== previousDomainRegexAsString && options.domainBlocklistRegex.length === 0) {
        Logger.debug("Removing Domain Blocklist Regex Filtering");
        previousDomainRegexAsString = '';
        domainBlocklistRegex = null;
    } else {
        if (options.domainBlocklistRegex !== previousDomainRegexAsString) {
            previousDomainRegexAsString = options.domainBlocklistRegex;
            Logger.debug({ domainBlocklistRegex: previousDomainRegexAsString }, "Modifying Domain Blocklist Regex");
            domainBlocklistRegex = new RegExp(options.domainBlocklistRegex, 'i');
        }
    }

    if (options.emailBlocklistRegex !== previousEmailRegexAsString && options.emailBlocklistRegex.length === 0) {
        Logger.debug("Removing Email Blocklist Regex Filtering");
        previousEmailRegexAsString = '';
        emailBlocklistRegex = null;
    } else {
        if (options.emailBlocklistRegex !== previousEmailRegexAsString) {
            previousEmailRegexAsString = options.emailBlocklistRegex;
            Logger.debug({ emailBlocklistRegex: previousEmailRegexAsString }, "Modifying Email Blocklist Regex");
            emailBlocklistRegex = new RegExp(options.emailBlocklistRegex, 'i');
        }
    }
}

function doLookup(entities, options, cb) {
    let blocklist = options.blocklist;
    let lookupResults = [];

    _setupRegexBlocklists(options);

    Logger.trace({ blocklist: blocklist }, "checking to see what blocklist looks like");

    async.each(entities, function (entityObj, next) {
        if (_.includes(blocklist, entityObj.value)) {
            next(null);
        } else if (entityObj.isEmail) {
            if (emailBlocklistRegex !== null) {
                if (emailBlocklistRegex.test(entityObj.value)) {
                    Logger.debug({ email: entityObj.value }, 'Blocked BlockListed Email Lookup');
                    return next(null);
                }
            }
            _lookupEntity(entityObj, options, function (err, result) {
                if (err) {
                    next(err);
                } else {
                    lookupResults.push(result);
                    Logger.debug({ result: result }, "Checking the result values ");
                    next(null);
                }
            });
        } else if (entityObj.isDomain) {
            if (domainBlocklistRegex !== null) {
                if (domainBlocklistRegex.test(entityObj.value)) {
                    Logger.debug({ domain: entityObj.value }, 'Blocked BlockListed Domain Lookup');
                    return next(null);
                }
            }
            _lookupEntityDomain(entityObj, options, function (err, result) {
                if (err) {
                    next(err);
                } else {
                    lookupResults.push(result);
                    Logger.debug({ result: result }, "Checking the result values ");
                    next(null);
                }
            });
        } else {
            next(null);
        }
    }, function (err) {
        Logger.trace(err, "ERROR")
        Logger.trace({ lookupResults: lookupResults }, "lookupresulsts");
        cb(err, lookupResults);
    });
}


function _lookupEntity(entityObj, options, cb) {

    let requestOptions = {
        uri: options.baseUrl + '/api/search/email/' + entityObj.value,
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
        Logger.debug({ body: body }, "Printing out the results of Body ");

        Logger.debug({ body: body }, "Checking Null issues for body");

        // TODO write and implement function here to filter out data from body.data that isn't within date
        const pastebins = getPastebins(options, body);

        if (!pastebins.length)
            return cb(null, {
                entity: entityObj,
                data: null // setting data to null indicates to the server that this entity lookup was a "miss"
            });


        // The lookup results returned is an array of lookup objects with the following format
        cb(null, {
            // Required: This is the entity object passed into the integration doLookup method
            entity: entityObj,
            // Required: An object containing everything you want passed to the template
            data: {
                // Required: These are the tags that are displayed in your template
                summary: ["Total Pastebin Dumps: " + pastebins.length],
                // Data that you want to pass back to the notification window details block
                details: pastebins
            }
        });
    });
}

function _lookupEntityDomain(entityObj, options, cb) {

    let requestOptions = {
        uri: options.baseUrl + '/api/search/domain/' + entityObj.value,
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
        Logger.debug({ body: body }, "Printing out the results of Body ");

        const pastebins = getPastebins(options, body);
        if (!pastebins.length)
            return cb(null, {
                entity: entityObj,
                data: null // setting data to null indicates to the server that this entity lookup was a "miss"
            });

        // The lookup results returned is an array of lookup objects with the following format
        cb(null, {
            // Required: This is the entity object passed into the integration doLookup method
            entity: entityObj,
            // Required: An object containing everything you want passed to the template
            data: {
                // Required: These are the tags that are displayed in your template
                summary: ["Total Pastebin Dumps: " + pastebins.length],
                // Data that you want to pass back to the notification window details block
                details: pastebins
            }
        });
    });
}

const getPastebins = (options, body) => fp.flow(
    fp.getOr([], "data"),
    fp.filter(
        ({ time }) =>
            !options.useDateFilter ||
            moment.utc(new Date()).diff(moment(time), "days", false) <=
                DAYS_TO_LOOK_BACK
    )
)(body);

function _isLookupMiss(response) {
    return response.statusCode === 404 || response.statusCode === 500 || response.statusCode === 400;
}

function _createJsonErrorPayload(msg, pointer, httpCode, code, title, meta) {
    let errors = [_createJsonErrorObject(msg, pointer, httpCode, code, title, meta)];

    log.error({ errors: errors });

    return { errors: errors };
}

function _createJsonErrorObject(msg, pointer, httpCode, code, title, meta) {
    let error = {
        detail: msg,
        status: httpCode.toString(),
        title: title,
        code: 'RL_' + code.toString()
    };

    if (pointer) {
        error.source = {
            pointer: pointer
        };
    }

    if (meta) {
        error.meta = meta;
    }

    return error;
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
            body: body,
            entityValue: entityValue
        });
    }

    return null;
}

function validateOptions(userOptions, cb) {
    let errors = [];

    if (typeof userOptions.domainBlocklistRegex.value === 'string' && userOptions.domainBlocklistRegex.value.length > 0) {
        try {
            new RegExp(userOptions.domainBlocklistRegex.value);
        }
        catch (error) {
            errors.push({
                key: 'domainBlocklistRegex',
                message: error.toString()
            });
        }
    }

    if (typeof userOptions.emailBlocklistRegex.value === 'string' && userOptions.emailBlocklistRegex.value.length > 0) {
        try {
            new RegExp(userOptions.emailBlocklistRegex.value);
        }
        catch (e) {
            errors.push({
                key: 'emailBlocklistRegex',
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
