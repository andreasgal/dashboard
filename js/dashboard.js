/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */

var releases = ["1.3", "1.3T", "1.4"]; // which releases to show
var reload = 0; // reload every this many seconds (0 means disabled)
var showOwners = false; // show the owner instead of the component
var showActivity = false; // use age of least active bug to color tile instead of release color
var maxAge = 7; // maximum age in days (deep red for showActivity)

// Flags we will filter by and the results of the bug queries.
var nomination_flag = suffix(releases, "?");
var blocking_flag = suffix(releases, "+");
var nominations;
var untriaged;
var blocking;

// Parse the url and extract configuration information.
parseQueryString(function (name, value, integer, list) {
  switch (name) {
  case "releases":
    releases = list;
    break;
  case "reload":
    reload = integer;
    break;
  case "owners":
    showOwners = true;
    break;
  case "activity":
    showActivity = true;
    break;
  case "maxage":
    maxAge = integer;
    break;
  }
});

// Initially hide the body and fade it in when we get some data to show.
$("body").hide();

$("div#toggleOwners").click(function () {
  var checkbox = $(this);
  checkbox.toggleClass("checked");
  showOwners = checkbox.hasClass("checked");
  refresh();
});

$("div#toggleHelp").click(function () {
  var checkbox = $(this);
  checkbox.toggleClass("checked");
  $("div#help").toggle(400);
});
$("div#help").hide();

function refresh() {
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

  function rgb(r, g, b) {
    return "rgb(" + Math.round(255 * r) + "," + Math.round(255 * g) + "," + Math.round(255 * b) + ")";
  }

  // Get a color based on a status (0..1, 0 is red, 1 is green).
  function getStatusColor(status) {
    return "style='background-color: " + rgb(1-status, status, 0) + "'";
  }

  // Create a search query link for bugzilla we can redirect to.
  function getLink(release, component, assigned_to) {
    var url = "https://bugzilla.mozilla.org/buglist.cgi?";
    var args = [];

    function push(field, value) {
      if (typeof value === "object") {
        $.each(value, function (_, v) {
          push(field, v);
        });
        return;
      }
      args.push([field, value]);
    }

    push("bug_status", ["UNCONFIRMED", "NEW", "ASSIGNED", "REOPENED"]);
    if (release)
      push("cf_blocking_b2g", release);
    if (component)
      push("component", component);
    if (assigned_to)
      push("assigned_to", assigned_to);
    $.each(args, function (n, arg) {
        args[n] = encodeURIComponent(arg[0]) + "=" + encodeURIComponent(arg[1]);
      });
    return "href='" + url + args.join("&") + "'";
  }

  function brace(s) {
    return "(" + s + ")";
  }

  function formatCount(className, release, component, assigned_to, count) {
    var html = "<a";
    if (className)
      html += " class='" + className + "'";
    html += " " + getLink(release, component, assigned_to);
    html += ">";
    html += count;
    html += "</a>";
    return html;
  }
  function formatCounts(className, release, component, count) {
    var html = formatCount(className, release, component, null, accumulate(count));
    var unassigned = accumulate(count, "nobody@mozilla.org");
    if (unassigned > 0)
      html += " " + formatCount(className + " unassigned", release, component, "nobody@mozilla.org", brace(unassigned));
    return html;
  }
  function formatStatus(counts, component) {
    var html = "<ul id='status'>";
    eachAlphabetically(counts, function (release, count) {
      var color;
      if (showActivity) {
        // Determine the oldest activity.
        var oldest = Date.now();
        $.each(count, function (assigned_to, dates) {
          $.each(dates, function (date) {
            oldest = Math.min(new Date(date).getTime(), oldest);
          });
        });
        // Calculate the age in days and cap to 7 days.
        var age = Math.min(maxAge, (Date.now() - oldest) / 1000 / 60 / 60 / 24);
        color = getStatusColor(1 - age / maxAge);
      } else {
        color = getReleaseColor(release.replace("+", "").replace("?", ""));
      }
      html += "<li " + color + ">";
      html += "<div class='release'>" + release + "</div>";
      html += formatCounts("count", release, component, count);
      html += "</li>";
    });
    html += "</ul>";
    return html;
  }
  function formatComponents(components) {
    var html = "<ul id='components'>";
    eachAlphabetically(components, function (component, counts) {
      var label = (showOwners && (component in OWNERS))
                  ? OWNERS[component]
                  : component;
      html += "<li>";
      html += "<div class='component'>" + label + "</div>";
      html += formatStatus(counts, component);
      html += "</li>";
    });
    html += "</ul>";
    return html;
  }

  $("li#noms").empty().append("<div>Nominations: " +
                              formatCounts(null, nomination_flag, null, nominations) +
                              "</div>").append(formatStatus(nominations));
  if (untriaged) {
    $("li#triage").empty().append("<div>Triage: " +
                                  formatCounts(null, blocking_flag, "General", untriaged) +
                                  "</div>").append(formatStatus(untriaged, "General"));
  }
  $("li#blockers").empty().append("<div>Blockers: " +
                                  formatCounts(null, blocking_flag, null, blocking) +
                                  "</div>").append(formatComponents(blocking));
}

function update() {
  function without(obj, field) {
    obj = $.extend(true, {}, obj);
    delete obj.field;
    return obj;
  }

  $.when(
    group(all().blocking(nomination_flag).open(), ["cf_blocking_b2g", "assigned_to", "last_change_time"]).then(function (counts) {
      nominations = counts;
    }),
    group(all().blocking(blocking_flag).open(), ["component", "cf_blocking_b2g", "assigned_to", "last_change_time"]).then(function (counts) {
      untriaged = ("General" in counts) ? counts.General : null;
      blocking = without(counts, "General");
    })
  ).then(function() {
    refresh();
    $("body").fadeIn(400);
  });

  // Reload the data set if requested.
  if (reload) {
    setTimeout(update, reload * 1000);
  }
}

$(function () {
  update();
});
