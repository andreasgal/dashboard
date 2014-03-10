/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */

var releases = ["1.3", "1.3T", "1.4", "1.5"]; // which releases to show
var reload = 0; // reload every this many seconds (0 means disabled)

// Parse the url and extract configuration information.
parseQueryString(function (name, value, integer, list) {
  switch (name) {
  case "releases":
    releases = list;
    break;
  case "reload":
    reload = integer;
    break;
  }
});

// Initially hide the body and fade it in when we get some data to show.
$("body ul").hide();

function update() {
  // Assign a unique color and return it as a class declaration
  var getUniqueColor = (function () {
    var color = 0;
    return function () {
      return "class='color" + (color++) + "'";
    };
  })();

  // Get the color for a release as a class declaration
  var getReleaseColor = (function () {
    var colors = [];
    return function (canonical) {
      if (!(canonical in colors)) {
        colors[canonical] = getUniqueColor();
      }
      return colors[canonical];
    };
  })();

  // Create a search query link for bugzilla we can redirect to.
  function getLink(release, component) {
    var url = "https://bugzilla.mozilla.org/buglist.cgi?";
    var args = [["bug_status", "UNCONFIRMED"],
                ["bug_status", "NEW"],
                ["bug_status", "ASSIGNED"],
                ["bug_status", "REOPENED"]];
    if (release)
      args.push(["cf_blocking_b2g", release]);
    if (component)
      args.push(["component", component]);
    $.each(args, function (n, arg) {
        args[n] = encodeURIComponent(arg[0]) + "=" + encodeURIComponent(arg[1]);
      });
    return "href='" + url + args.join("&") + "'";
  }

  function formatStatus(counts, component) {
    var html = "<ul id='status'>";
    eachAlphabetically(counts, function (release, count) {
      var canonical = release.replace("+", "").replace("?", "");
      html += "<li " + getReleaseColor(canonical) + ">";
      html += "<div id='release'>" + release + "</div>";
      html += "<a id='count' " + getLink(release, component) + ">" + count + "</a>";
      html += "</li>";
    });
    html += "</ul>";
    return html;
  }
  function formatComponents(components) {
    var html = "<ul id='components'>";
    eachAlphabetically(components, function (component, counts) {
      html += "<li><div>" + component + "</div>";
      html += formatStatus(counts, component);
      html += "</li>";
    });
    html += "</ul>";
    return html;
  }

  var show = (function () {
    var waiting = 2;
    return function () {
      if (--waiting === 0) {
        $("body ul").fadeIn(400);
      }
    };
  })();

  group(all().blocking(suffix(releases, "?")).open(), ["cf_blocking_b2g"], function (error, counts) {
    $("li#noms").empty().append("<div>Nominations</div>").append(formatStatus(counts));
    show();
  });
  group(all().blocking(suffix(releases, "+")).open(), ["component", "cf_blocking_b2g"], function (error, counts) {
    if ("General" in counts) {
      $("li#triage").empty().append("<div>Triage</div>").append(formatStatus(counts.General, "General"));
      delete counts.General;
    }
    $("li#blockers").empty().append("<div>Blockers</div>").append(formatComponents(counts));
    show();
  });

  // Reload the data set if requested.
  if (reload) {
    setTimeout(update, reload * 1000);
  }
}

$(function () {
  update();
});
