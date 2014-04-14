"use strict";

// Global data values.
var config = {};
var data = undefined;
var plot = null;

// Initializer for the global data.
function create_data() {
    return {
        // Retrieval state.
        meta_bug : undefined,
        all_bugs : {},
        suppressed_bugs : [],
        todo_bugs : [],
        outstanding_bugs : 0,
        total_bugs : 0,

        // Computed stats.
        added : {},
        live : {},
        fixed : {},
        today : undefined,
        oldest_day : undefined
    };
}

// Retrieve bugs one at a time because sometimes we can't see
// one for security reasons and if we retrieve multiple bugs
// at once, then the whole request fails.
function retrieve_bug(bug_id) {
    var d = new $.Deferred();
    
    var q = query("Bug.get", [{ids:[bug_id]}]);
    
    data.outstanding_bugs++;
    data.total_bugs++;
    q.then(function (more) {
        more.bugs.forEach(function(bug) {
            data.all_bugs[bug.id] = bug;
            // Report our dependencies.
            d.resolve(bug.depends_on);
        });
    });

    q.fail(function() {
        console.log("Couldn't retrieve bug " + bug_id);
        // Bugs which don't exist don't have dependencies.
        d.resolve([]);
    });

    return d;
}

function get_more_dependencies(d) {
    data.todo_bugs.forEach(function(bug) {
        retrieve_bug(bug).then(function(dependencies) {
            data.outstanding_bugs--;
            dependencies.forEach(function(dep) {
                if (data.all_bugs[dep])
                    return;  // Already retrieved.
                
                if (data.todo_bugs.indexOf(dep) !== -1)
                    return;  // Already on TODO list.
                
                if (data.suppressed_bugs.indexOf(dep) != -1)
                    return;  // Suppressed
                
                data.todo_bugs = data.todo_bugs.concat(dep);
            });
        
            if (data.todo_bugs.length === 0) {
                if (!data.outstanding_bugs) {
                    console.log("Got all bugs");
                    d.resolve(data.all_bugs);
                }
            }
            else {
                console.log("Still more bugs to look at");
                console.log(data.todo_bugs);
                get_more_dependencies(d);
            }
        });
    });

    data.todo_bugs = [];
}

function get_all_dependencies(bug) {
    var d = new $.Deferred();
    data.todo_bugs = [bug];

    get_more_dependencies(d);
    
    return d;
}

function date2day(d) {
    return Math.floor(d.getTime() / 86400000);
}

function increment_ctr(a, d) {
    if (!a[d])
        a[d] = 0;
    
    a[d]++;
}

function is_completed(b) {
    if (!b.is_open)
        return true;

    if (b.whiteboard.indexOf("landed") !== -1)
        return true;

    return false;
}

function compute_metrics() {
    data.today = date2day(new Date());
    data.oldest_day = date2day(new Date(data.all_bugs[data.meta_bug].creation_time));

    var day;

    $.map(data.all_bugs, function(b, index) {
        var d = date2day(new Date(b.creation_time));
            
        b.burndown_creation_date = d;
        if (!is_completed(b)) {
            b.burndown_resolution_date = data.today + 1;
        } else {
            b.burndown_resolution_date = date2day(new Date(b.last_change_time));
            increment_ctr(data.fixed, b.burndown_resolution_date);
        }

        increment_ctr(data.added, b.burndown_creation_date);

        for (day = b.burndown_creation_date; day < b.burndown_resolution_date; ++day) {
            increment_ctr(data.live, day);
        }
    });
}

function graph_metrics() {
    var series_live = [];
    var series_added = [];
    var series_fixed = [];
    var max_live = 0;
    var total_added = 0;
    var total_fixed = 0;

    $.map(data.live, function(v, k) {
        if (max_live < v)
            max_live = v;

        series_live.push([k-data.oldest_day, v]);
    });

    $.map(data.added, function(v, k) {
        series_added.push([k-data.oldest_day, v]);
        total_added += v;
    });

    $.map(data.fixed, function(v, k) {
        series_fixed.push([k-data.oldest_day, v]);
        total_fixed += v;
    });
    

    $("#burndown").show();

    if (plot)
        plot.destroy();

    plot = $.jqplot('burndown',
                         [series_live,
                          series_added,
                          series_fixed],
                         {
                             title : "Burndown",
                             axes : {
                                 xaxis : {
                                     min : 0,
                                     max : data.today - data.oldest_day
                                 },
                                 yaxis : {
                                     min : 0,
                                     max: ((max_live / 10) +1 ) * 10
                                 }
                             },
                             seriesDefaults : {
                                 shadow: false
                             },
                             series : [
                                 {   showMarker: false,
                                     label : "Open"
                                 },
                                 {
                                     label : "Added",
                                     renderer:$.jqplot.BarRenderer,
                                     rendererOptions : {
                                         barWidth:4
                                     }
                                 },
                                 {
                                     label : "Fixed",
                                     renderer:$.jqplot.BarRenderer,
                                     rendererOptions : {
                                         barWidth:4
                                     }
                                 }
                             ],
                             legend : {
                                 show : true
                             }
                         }
                        );

    $('burndown').bind('jqplotDataClick', function(ev, seriesIndex, pointIndex, data) {
        console.log(ev, seriesIndex, pointIndex, data);
    });

    $("#stats").append(document.createTextNode("Open bugs: " + data.live[data.today]));
    $("#stats").append(document.createElement("br"));
    $("#stats").append(document.createTextNode("Total bugs: " + total_added));
    $("#stats").append(document.createElement("br"));
    $("#stats").append(document.createTextNode("Fixed bugs: " + total_fixed));
}

function update(meta_bug) {
    if (isNaN(meta_bug)) {
        alert("Invalid bug number");
        return;
    }
    data = create_data();
    data.meta_bug = meta_bug;

    $("#stats").empty();
    $("#burndown").hide();
    console.log("Making chart for bug " + meta_bug);

    get_all_dependencies(meta_bug).then(function(x) {
        compute_metrics();
        graph_metrics();
    });
}

function form_submit()  {
    var bug = $("#bug_id").val();

    update(parseInt(bug, 10));
}


// Parse the url and extract configuration information.
parseQueryString(function (name, value, integer, bool, list) {
  switch (name) {
  case "bug":
    config.meta_bug = value;
    break;
  }
});

$(function() {
    $("#make_chart").submit(function(event) {
        event.preventDefault();
        form_submit();
    });

    if (config.meta_bug) {
        $("#bug_id").val(config.meta_bug);
        update(parseInt(config.meta_bug,10));
    }
});
