var EventEmitter = require("vendor/EventEmitter");
var cmp_events = new EventEmitter();

var LOADED_COMPONENTS = require("common/component_register");

var debug = require("common/debug").make();
debug.DEBUG = false;

var rpc_handler = {
  get: function rpc_handler(target, prop) {
    var fn = target.__bridge[prop];
    if (!fn) {
      throw prop + "is not an RPC function on " +  target.id;
    }

    return _.bind(fn, target);
  }
}

var _injected_css = {};
function inject_css(name, css) {
  if (_injected_css[name]) {
    return css;
  }
  debug("INJECTED CSS FOR", name);

  var to_inject;
  if (_.isString(css)) {
    to_inject = css;
  }
  if (_.isObject(css)) {
    to_inject = css.code;
  }

  var stylesheetEl = $('<style type="text/css" media="screen"/>');
  stylesheetEl.text(to_inject);
  stylesheetEl.attr("data-name", name);

  $("head").append(stylesheetEl);
  _injected_css[name] = true;

  return css;
}

function wait_for_refs(refs, cb) {
  var needed = 0;

  if (!refs) {
    return cb();
  }
  debug("WAITING FOR REFS", refs);

  var after = _.after(_.keys(refs).length, function() {
    debug("REFS LOADED", refs, "MOVING ON");
    cb();
  });

  _.each(refs, function(r, k) {
    if (LOADED_COMPONENTS[r]) {
      after();
    } else {
      cmp_events.once("cmp::" + r, function() {
        after();
      });
    }
  });
}

function find_replacement_refs(d, out) {
  if (_.isElement(d)) {
    return d;
  }

  if (_.isObject(d)) {
    // TODO: hmmm... these _tails need to be registered somewhere
    if (d._B) {
      out[d._B] = d._B;
    } else if (d._R) {
      out[d._R] = d._R;
    } else {
      _.each(d, function(v, k) { d[k] = find_replacement_refs(v, out); });
    }

  }

  if (_.isArray(d)) {
    _.each(d, function(v) { find_replacement_refs(v, out) });
  }

  return d;
}

var _marshallers = {};
var _unmarshallers = {};
function register_marshaller(name, fn) {
  _marshallers[name] = fn;
}

function register_unmarshaller(name, fn) {
  _unmarshallers[name] = fn;
}

register_marshaller('HTMLElement', function(d) {
  if (_.isElement(d)) { return { "_H" : d.id }; }
});

register_marshaller('Backbone', function(d) {
  if (typeof Backbone != "undefined") {
    if (d instanceof Backbone.View) { return { "_B" : d.id, "_C": d._type }; }
  }
});

register_marshaller('React', function(d) {
  if (d._type) { return { "_R" : d.id, "_C" : d._type }; }
});

register_unmarshaller('HTMLElement', function(d) {
  if (d._H) {
    var r = d;
    d = $("#" + r._H);
    if (!d.length) {
      console.log("Can't find HTML element for", r._H,
        "make sure it is placed into the page!");
    }

    d = d[0];
    debug("REPLACED _H REF", r._H, d);

    return d;
  }
});

var MISSING_COMPONENT = "COMPONENT_MISSING";
register_unmarshaller('Backbone', function(d) {
  if (d._B) {
    return LOADED_COMPONENTS[d._B] || MISSING_COMPONENT;
  }
});

register_unmarshaller('React', function(d) {
  if (d._R) {
    return LOADED_COMPONENTS[d._R] || MISSING_COMPONENT;
  }
});

function marshal_component(d) {
  var ret;
  _.each(_marshallers, function(v, k) {
    if (ret) { return; }

    var r = v(d);
    if (r && d != r) { ret = r; }
  });

  if (ret) { return ret; }
}

function unmarshal_component(d) {
  var ret;
  _.each(_unmarshallers, function(v, k) {
    if (ret) { return };
    var r = v(d);
    if (r && r != d) {
      ret = r;
    }
  });

  if (ret) { return ret; }

}

function place_refs(d) {
  if (!d) { return d; }

  var boxed = marshal_component(d);
  if (boxed) {
    return boxed;
  }


  if (_.isObject(d)) {
    _.each(d, function(v, k) {
      d[k] = place_refs(v);

    });
  } else if (_.isArray(d)) {
    return _.map(d, place_refs);
  }

  return d;

}

// recursively walk down d and replace references
// with their actual components
function replace_refs(d) {
  if (!d || _.isElement(d)) {
    return d;
  }

  if (typeof(window.React) !== "undefined" && React.isValidElement(d)) {
    return d;
  }

  if (_.isObject(d)) {
    var unboxed = unmarshal_component(d);
    if (unboxed) {
      return unboxed;
    }

    _.each(d, function(v, k) {

      d[k] = replace_refs(v);
    });

  } else if (_.isArray(d)) {
    _.each(d, replace_refs);
  }

  return d;

}


function activate_triggers(id, ref) {
  cmp_events.trigger("cmp::" + id);
  if (ref) { cmp_events.trigger("ref::" + ref); }

}

function activate_component(id, name, cls, context, ref, activator) {
  var cmpEl = document.getElementById(id);

  context.id = id;
  context.el = cmpEl;
  $(context.el).addClass("scoped_" + name);

  var refs = {};
  find_replacement_refs(context, refs);
  wait_for_refs(refs, function() {
    context = replace_refs(context);

    var cmpInst = activator(context);
    cmpInst._type = name;

    LOADED_COMPONENTS[id] = cmpInst;
    if (ref) {
      $C._refs[ref] = cmpInst;
    }

    debug("INSTANTIATED COMPONENT", id, name, cmpInst);
    inject_css("display_" + id, "\n#" + id + " { display: block !important } \n");


    if (!cmpInst.__bridge) {
      return activate_triggers(id, ref);
    }

    $C("ComponentBridge", function() {
      // TODO: come back to this and fix RPC to not be a proxy?
      cmpInst.rpc = new Proxy(cmpInst.__bridge, {
        get: function(target, prop) {
          return rpc_handler.get(cmpInst, prop)
        }
      });

      activate_triggers(id, ref);

    });
  });
}
function call_on_component(id, fn, args, kwargs) {
  var refs = { };

  refs[id] = id;
  find_replacement_refs(args, refs);
  find_replacement_refs(kwargs, refs);

  wait_for_refs(refs, function() {
    args = replace_refs(args);
    kwargs = replace_refs(kwargs);
    var cmp = LOADED_COMPONENTS[id];
    if (_.isFunction(cmp[fn])) {
      var oldkw = cmp[fn].__kwargs__;
      var oldargs = cmp[fn].__args__;

      cmp[fn].__kwargs__ = kwargs;
      cmp[fn].__args__ = args;
      try {
        cmp[fn].apply(cmp, args);
      } finally {
        cmp[fn].__kwargs__ = oldkw;
        cmp[fn].__args__ = oldargs;
      }

    } else {
      console.error("NO SUCH FUNCTION", fn, "IN COMPONENT", id);
    }
  });
}

module.exports = {
  find_replacement_refs: find_replacement_refs,
  replace_refs: replace_refs,
  place_refs: place_refs,
  inject_css: inject_css,
  wait_for_refs: wait_for_refs,
  cmp_events: cmp_events,
  activate_component: activate_component,
  call_on_component: call_on_component
}
