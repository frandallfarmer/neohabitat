function mhelp() {
    print("  eget(ref)               return an object descriptor for object <ref>");
    print("  eremove(ref)            delete object <ref>");
    print("  eclone(oldref, newref)  copy object <oldref> and return it as <newref>");
    print("  esave(obj)              write object descriptor <obj>");
    print("  boxquery(lat, lon, range)  find objects within <range> meters of <lat>,<lon>");
    print("  igrab(uref, iref)       have user <uref> grab item <iref> from wherever it is");
    print("  idrop(iref)             have anybody holding item <iref> drop it on the ground");
    print("  demoReset()             return demo objects to their owners");
    print("  demoConfig()            show demo reset configuration");
    print("  demoGrab(uref, iref)    in demo reset, make <uref> holds <iref>");
    print("  demoDrop(iref)          in demo reset, never mind about <iref>");
    print("  addClass(tag, fqn, [ctref])   define <tag> to label Java class <fqn> in class");
    print("      table <ctref> (default 'classes')");
    print("  addStatic(key, ref)     define <key> to label static object <ref>");
}

function eget(ref) { return db.odb.findOne({ref:ref}); }

function eremove(ref) { return db.odb.remove({ref:ref}); }

function esave(obj) { return db.odb.save(obj); }

function eupdateOne(obj) {
    var o = eget(obj.ref);
    if (o !== null) {
        obj._id = o._id;
    }
    esave(obj);
}
function eupdate(obj) {
	if (obj instanceof Array) {
		obj.forEach(function (o) { eupdateOne(o); } );
	} else {
		eupdateOne(obj);
	}

}

function boxquery(lat, lon, range) {
    var ONE_METER_LAT = 9.04369502581408e-06;
    var ONE_METER_LON = 8.98315548751594e-06;

    var offset = range * ONE_METER_LAT;
    var minlat = lat - offset;
    var maxlat = lat + offset;

    offset = range * ONE_METER_LON;
    var minlon = lon - offset;
    var maxlon = lon + offset;

    query = {
        type: "item",
        _qpos_: { $within: { $box: [[minlat, minlon], [maxlat, maxlon]] }}
    };

    db.odb.find(query).forEach(function (obj) { print(obj.ref); });
}

function eclone(oldref, newref) {
   var obj = eget(oldref);
   delete obj._id;
   obj.ref = newref;
   return obj;
}

function multiclone(oldref, newref, count) {
    for (i = 1; i <= count; ++i) {
        var obj = eclone(oldref, newref + "." + i);
        eupdate(obj);
    }
}

function egeti(iref) {
    var obj = eget(iref);
    if (!obj) {
        print("no item " + iref);
        return null;
    } else if (obj.type != "item") {
        print("object " + iref + " is not an item");
        return null;
    } else {
        return obj;
    }
}

function egetu(uref) {
    var user = eget(uref);
    if (!user) {
        print("no user " + uref);
        return null;
    } else if (user.type != "user") {
        print("object " + uref + " is not a user");
        return null;
    } else {
        return user;
    }
}

function emod(obj, mtype) {
/* TODO Maybe fix this some day, my mongo started choking on this
    for (var mod of obj.mods) {
        if (mod.type == mtype) {
            return mod;
        }
    }
    print("item " + obj.ref + " does not have a(n) " + mtype + " mod");
*/
	return null;
}


function setpos(obj, lat, lon) {
    obj.pos.lat = lat;
    obj.pos.lon = lon;
    obj._qpos_.lat = lat;
    obj._qpos_.lon = lon;
}

function demoConfig() {
    return eget("x-demodesc").users;
}

function demoReset() {
    var desc = eget("x-demodesc");
    if (!desc) {
        print("no x-demodesc object configured");
        return;
    }
    var users = desc.users;
    for (var uref in users) {
        if (users.hasOwnProperty(uref)) {
            var items = users[uref];
            for (var i = 0; i < items.length; ++i) {
                igrab(uref, items[i]);
            }
        }
    }
}

function demoGrab(uref, iref) {
    var desc = eget("x-demodesc");
    if (!desc) {
        desc = { ref: "x-demodesc", users: { } };
    }
    var users = desc.users;
    if (!users[uref]) {
        users[uref] = [];
    }
    for (var u in users) {
        if (users.hasOwnProperty(u)) {
            var items = users[u];
            for (var i = 0; i < items.length; ++i) {
                if (items[i] == iref) {
                    if (u == uref)  {
                        return;
                    } else {
                        items.splice(i, 1);
                        break;
                    }
                }
            }
        }
    }
    users[uref].push(iref);
    esave(desc);
}

function demoDrop(iref) {
    var desc = eget("x-demodesc");
    if (!desc) {
        return;
    }
    var users = desc.users;
    for (var u in users) {
        if (users.hasOwnProperty(u)) {
            var items = users[u];
            for (var i = 0; i < items.length; ++i) {
                if (items[i] == iref) {
                    items.splice(i, 1);
                    break;
                }
            }
        }
    }
    esave(desc);
}

function iholders(iref) {
    var result = [];
    db.odb.find({ref$contents:iref}).forEach(function (obj) {
            result.push(obj.ref); });
    return result;
}

function idrop(iref) {
/* TODO Maybe fix this some day. Mongo is choking on this.
    var holders = iholders(iref);
    for (var uref of holders) {
        var user = egetu(uref);
        for (var i = 0; i < user.ref$contents.length; ++i) {
            if (user.ref$contents[i] == iref) {
                user.ref$contents.splice(i, 1);
                esave(user);

                var item = egeti(iref);
                var thing = emod(item, "thing");
                thing.ctx = "ctx-world";
                thing.owner = uref;
                thing.ownerName = user.name;
                setpos(item, user.pos.lat, user.pos.lon);
                esave(item);
                break;
            }
        }
    }
*/
}


function igrab(uref, iref) {
    idrop(iref);

    var user = egetu(uref);
    user.ref$contents.push(iref);
    esave(user);

    var item = egeti(iref);
    var thing = emod(item, "thing");
    thing.ctx = "none";
    delete thing.owner;
    delete thing.ownerName;
    esave(item);
}

function addClass(tag, fqn, descref) {
    descref = descref || "classes";
    var desc = eget(descref);
    desc.classes.push({ type: "class", tag: tag, name: fqn });
    esave(desc);
}

function addStatic(key, ref) {
    var desc = eget("statics");
    desc.statics.push({ key: key, ref: ref });
    esave(desc);
}

function showUsers() {
    db.odb.find({ ref: /^u-/ }).forEach(function(u) {
            if (!u.ref.match(/^u-testuser_/)) {
                print(u.ref);
            }
        });
}

function showObjs() {
    db.odb.find({ ref: { $exists: true }}).sort({ref:1}).forEach(function(o) {
            print(o.ref);
        });
}

function socialGraph(uref) {
    var o = eget("g-u-" + uref);
    if (o) {
        print(o.conn);
    } else {
        print("no social graph data for " + uref);
    }
}

function makeSocialLink(ufrom, uto) {
    var g = eget("g-u-" + ufrom);
    if (!g) {
        g = { type:"ugraf", ref:"g-u-"+ufrom, conn:[] };
    }
    g.conn.push("u-" + uto);
    esave(g);
}

function makeSocialConnection(u1, u2) {
    makeSocialLink(u1, u2);
    makeSocialLink(u2, u1);
}


