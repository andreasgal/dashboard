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
        total_estimates : 0,

        // Computed stats.
        added : {},
        live : {},
        live_work : {},
        fixed : {},
        added_bugs : {},
        fixed_bugs : {},
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

function increment_ctr(a, d, by) {
    if (!a[d])
        a[d] = 0;
    
    a[d] += by || 1;
}

function add_entry(a, d, b) {
    if (!a[d])
        a[d] = [];
    
    a[d].push(b);
}

function is_completed(b) {
    if (!b.is_open)
        return true;

    if (b.whiteboard.indexOf("landed") !== -1)
        return true;

    return false;
}

function compute_estimate(b) {
    var m = b.whiteboard.match(/\[est:\s*([\d\/]+)([dh])?\]/);
    var m2;
    var divisor;
    var multiplier = 8;

    if (!m) {
        console.log("No estimate for bug " + b.id + "-->" + b.whiteboard);
        return 0;
    }
    else {
        if (m[2] == 'h')
            multiplier = 1;

        m2 = m[1].match(/(^\d+$)/);
        if (m2) {
            return parseInt(m2[1], 10) * multiplier;
        }
        m2 = m[1].match(/^(\d+)\/(\d+)$/);
        if (m2) {
            divisor = parseInt(m2[2], 10);
            if (!divisor) {
                console.log("Can't have an fraction with a zero divisor");
                return 0;
            }
            
            return (parseInt(m2[1], 10)/parseInt(m2[2], 10)) * multiplier;
        }

        console.log("Bogus estimate value " + m[1]);
        return 0;
    }
}

function compute_metrics() {
    data.today = date2day(new Date());
    data.oldest_day = date2day(new Date(data.all_bugs[data.meta_bug].creation_time));
    
    var day;
    var estimate;

    $.map(data.all_bugs, function(b, index) {
        var d = date2day(new Date(b.creation_time));
            
        b.burndown_creation_date = d;
        estimate = compute_estimate(b);
        // Fill in defaults for non-meta bugs.
        if (!estimate) {
            if (b.summary.indexOf("meta") === -1) {
                estimate = 8;
            }
        }
        if (!estimate) {
            console.log("Bug " + b.id + " has 0 estimate");
        }

        if (!is_completed(b)) {
            b.burndown_resolution_date = data.today + 1;

            data.total_estimates += estimate;
        } else {
            b.burndown_resolution_date = date2day(new Date(b.last_change_time));
            increment_ctr(data.fixed, b.burndown_resolution_date);
            add_entry(data.fixed_bugs, b.burndown_resolution_date, b);
        }

        increment_ctr(data.added, b.burndown_creation_date);
        add_entry(data.added_bugs, b.burndown_creation_date, b);

        for (day = b.burndown_creation_date; day < b.burndown_resolution_date; ++day) {
            if (day === 16113) {
                console.log("ESTIMATE = " + estimate);
            }
            increment_ctr(data.live, day);
            increment_ctr(data.live_work, day, estimate);
        }
    });
}


function project_regression(equation, x) {
    return (equation[0] * x) + equation[1];
}


function make_regression_line(series, tail_days) {
    var fit = regression('linear', series.slice(-1 * tail_days));
    var last_day = series[series.length - 1][0];
    var first_day = last_day - tail_days;
    var x_intercept = fit.equation[1] / (-1 * fit.equation[0]);
    var x_max = x_intercept;

    if (x_intercept < 0) {
        x_max = last_day;
    }
    
    if ((x_max - last_day) > 30) {
        x_max = last_day + 30;
    }
        
    var retval = {
        points : [
            [first_day, project_regression(fit.equation, first_day)],
            [x_intercept, project_regression(fit.equation, x_max)]
        ],
        equation : fit,
        x_intercept : x_intercept,
        x_max : x_max
    };
        
    console.log("Regression line:" + retval);
    console.log("Estimated completion date: " + x_intercept);
    return retval;
}

function graph_metrics() {
    var series_live = [];
    var series_added = [];
    var series_fixed = [];
    var series_live_work = [];
    var series_live_fit = null;
    var series_live_work_fit = null;
    var max_live = 0;
    var max_live_work = 0;
    var total_added = 0;
    var total_fixed = 0;
    var x_max = 0;

    $.map(data.live, function(v, k) {
        if (max_live < v)
            max_live = v;

        series_live.push([k-data.oldest_day, v]);
    });
    series_live_fit = make_regression_line(series_live, 14);
    x_max = series_live_fit.x_max;
    data.projected_bugs_completion = series_live_fit.x_intercept;

    $.map(data.live_work, function(v, k) {
        if (max_live_work < v)
            max_live_work = v;

        series_live_work.push([k-data.oldest_day, v]);
    });
    series_live_work_fit = make_regression_line(series_live_work, 14);
    if (series_live_work_fit.x_max > x_max) {
        x_max = series_live_work_fit.x_max;
    }
    data.projected_hours_completion = series_live_work_fit.x_intercept;
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
                          series_live_work,
                          series_added,
                          series_fixed,
                          series_live_fit.points,
                          series_live_work_fit.points
                         ],
                         {
                             title : "Burndown",
                             axes : {
                                 xaxis : {
                                     min : 0,
                                     max : x_max,
                                 },
                                 yaxis : {
                                     min : 0,
                                     max: ((max_live / 10) +1 ) * 10
                                 },
                                 y2axis : {
                                     min : 0,
                                     max: ((max_live_work / 10) +1 ) * 10
                                 }
                             },
                             seriesDefaults : {
                                 shadow: false
                             },
                             series : [
                                 {   showMarker: false,
                                     label : "Open"
                                 },
                                 {   showMarker: false,
                                     label : "Hours",
                                     yaxis : 'y2axis'
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
                                 },
                                 {   showMarker: false,
                                     label : "Projected open"
                                 },
                                 {   showMarker: false,
                                     label : "Projected hours",
                                     yaxis : 'y2axis'
                                 },

                             ],
                             legend : {
                                 show : true,
                                 location : 'nw'
                             }
                         }
                        );

    $('#burndown').bind('jqplotDataClick', function(ev, seriesIndex, pointIndex, val) {
        var d;

        switch(seriesIndex) {
        case 2:
            d = data.added_bugs;
            break;
        case 3:
            d = data.fixed_bugs;
            break;
        default:
            return;
        }

        console.log("Bugs = " + JSON.stringify(d[val[0] + data.oldest_day]));
    });

    $("#stats").append(document.createTextNode("Open bugs: " + data.live[data.today]));
    $("#stats").append(document.createElement("br"));
    $("#stats").append(document.createTextNode("Total bugs: " + total_added));
    $("#stats").append(document.createElement("br"));
    $("#stats").append(document.createTextNode("Fixed bugs: " + total_fixed));
    $("#stats").append(document.createElement("br"));
    $("#stats").append(document.createTextNode("Estimated remaining work: " +
                                               data.total_estimates + " person-hours"));
    $("#stats").append(document.createElement("br"));
    $("#stats").append(document.createTextNode("Estimated completion date (by bug count): " +
                                               Math.round(data.projected_bugs_completion)));
    $("#stats").append(document.createElement("br"));
    $("#stats").append(document.createTextNode("Estimated completion date (by estimates): " +
                                               Math.round(data.projected_hours_completion)));
    $("#stats").append(document.createElement("br"));
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
