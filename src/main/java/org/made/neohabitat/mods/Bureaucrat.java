package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.foundation.json.OptString;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;
import org.made.neohabitat.Openable;

/**
 * Habitat Bureaucrat Mod 
 * 
 * Your basic Habitat civil servant.
 * The bureaucrat-in-a-box is a special type of Oracle.
 * It is a container that can hold one thing, which
 * should be a head. The head is displayed as the 
 * bureaucrat's face.
 *
 *
 * @author TheCarlSaganExpress
 *
 */
public class Bureaucrat extends Openable implements Copyable, Runnable {
        
    public int HabitatClass() {
        return CLASS_BUREAUCRAT;
    }
    
    public String HabitatModName() {
        return "Bureaucrat";
    }
    
    public int capacity() {
        return 1;
    }
    
    public int pc_state_bytes() {
        return 0;
    }
    
    public boolean known() {
        return true;
    }
    
    public boolean opaque_container() {
        return false;
    }
    
    public boolean changeable() { 
        return true;
    }

    public boolean filler() {
        return false;
    }
    
    public String candidate1 = "";
    public String candidate2 = "";
    public String eventText  = "";
    public int candidateVote1 = 0;
    public int candidateVote2 = 0;
    public int minutes        = 1;
    public boolean isRunning = false;
            
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "open_flags", "key_lo", "key_hi" })
    public Bureaucrat(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted,
            OptInteger open_flags, OptInteger key_lo, OptInteger key_hi) {
        super(style, x, y, orientation, gr_state, restricted, open_flags, key_lo, key_hi, new OptInteger(0));
    }

    public Bureaucrat(int style, int x, int y, int orientation, int gr_state, boolean restricted, boolean[] open_flags, int key_lo, int key_hi) {
        super(style, x, y, orientation, gr_state, restricted, open_flags, key_lo, key_hi);
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Bureaucrat(style, x, y, orientation, gr_state, restricted, open_flags, key_lo, key_hi);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
        result.finish();
        return result;
    }
    
    public void bureaucrat_ASK(User from, OptString text) {
        String question = text.value("");
        Avatar avatar   = avatar(from);
        if (question.toLowerCase().indexOf("to:") == 0) {
            object_say(from, "I don't do ESP. Point somewhere else.");
        } 
        else {
            String command = question.split(" ")[0];
            String[] commandSplit = question.split(command);
            String remainder = "";
            if (commandSplit.length > 0) {
                remainder = commandSplit[commandSplit.length - 1].trim();
            }
            
	    String BureacratID = object().name().toLowerCase();
            switch(BureacratID) { //Use object().name() to differentiate the bureaucrats (before was gr_state)
            case "propertycrabot":
                switch(command.toUpperCase()) { // don't make people hold shift
                case "MOVE:":
                case "PROPERTY:":
                    turfcrat_MOVE(from, avatar, remainder);
                    break;
                case "WHERE:":
                    object_say(from, noid, "You live at " + prettyTurf(avatar.turf) + ".");
                    break;
                case "VACANT:":
                    turfcrat_VACANT(from, remainder);
                    break;
                default:
                    bureaucrat_HELP(from, 4);
                }
                break;
            case "vottingscrabot":
                switch(command) {
                case "CANDIDATE1:":
                    if(remainder.toLowerCase().equals("me")) {
                        candidate1 = from.name();
                    }
                    else
                        candidate1 = remainder;
                    object_say(from, noid, "The first candidate is " + candidate1);
                    break;
                case "CANDIDATE2:":
                    if(remainder.toLowerCase().equals("me")) {
                        candidate2 = from.name();
                    }
                    else
                        candidate2 = remainder;
                    object_say(from, noid, "The second candidate is " + candidate2);
                    break;
                case "WHO:":
                    object_say(from, noid, "It is " + candidate1 + " VS " + candidate2);
                    break;
                case "VOTE:":
                    if(remainder.equals(candidate1)) {
                        object_say(from, noid, "You voted for " + candidate1 + ". This message is private.");
                        candidateVote1++;
                    }
                    else if(remainder.equals(candidate2)) {
                        object_say(from, noid, "You voted for " + candidate2 + ". This message is private.");
                        candidateVote2++;
                    }
                    else
                        object_say(from, noid, "That is not a real candidate.");
                    break;
                case "BALLOT:":
                    object_say(from, noid, candidate1 + ": " + candidateVote1 + " " + candidate2 + ": " + candidateVote2);
                    break;
                case "RESET:":
                    candidate1 = "";
                    candidate2 = "";
                    candidateVote1 = 0;
                    candidateVote2 = 0;
                    break;
                default:
                    bureaucrat_HELP(from, 1);
                }
                break;
            case "messagescrabot":
                switch(command) {
                case "COMPLAINT:":
                    if (remainder.length() > 0) {
                        message_to_god(this, avatar, remainder);
                        object_say(from, noid, "Mmm hmm. Well, we'll just see what we can do.");
                    }
                    break;
                    
                case "SEND:":
                    if (remainder.length() > 0) {
                        Region.tellEveryone("Public Announcement on behalf of " + from.name() + ":", false);
                        Region.tellEveryone(remainder, true);
                    } 
                    break;
                case "MOTD:":
                    Region.SET_MOTD(from, remainder);
                    object_say(from, noid, "Message of the day has been set !");                    
                    break;
                case "TIME:":
                    if (remainder.matches("[0-9]+") && !isRunning) {
                        minutes = Integer.parseInt(remainder);
                        object_say(from, noid, "Annoucement set for " + minutes + " minute(s) from now.");
                    }
                    else
                        object_say(from, noid, "You may only enter a number for the TIME: command.");
                    break;
                case "TEXT:":
                    eventText = remainder;
                    object_say(from, noid, "Event text has been set !");
                    break;
                case "START:":
                    if(!isRunning) {
                        isRunning = true;
                        Region.tellEveryone("A public event by " + from.name() + " will start " + minutes + " minutes from now.", false);
                        context().scheduleContextEvent(minutes * 1000 * 60, this); //TODO: Replace with actual timers
                    }
                    else
                        object_say(from, noid, "A timer is already running !");
                    break;                    
                    
                default:
                    bureaucrat_HELP(from, 2);
                }
                break;
            }
        }
    }

    @JSONMethod({ "text" })
    public void ASK(User from, OptString text) {
        bureaucrat_ASK(from, text);
    }
    
    public void bureaucrat_HELP(User from, int count) {
        final String help_messages[] = { "ERROR: Must enter a message to announce an event.", /* 0 */
                "The commands are- CANDIDATE1:, CANDIDATE2:, WHO:, VOTE:, BALLOT:, RESET:", /* 1 */
                "Please proceed your message with COMPLAINT:, SEND:, MOTD: TIME:, TEXT:, or START:", /* 2 */
                "Please proceed your message with SEND:, MOTD: TIME:, TEXT:, or START:", /* 3 */
                "Say MOVE: <address> to change turfs (e.g. MOVE: Baker St 221), WHERE: for your address, VACANT: [street] for empty homes.", /* 4 */
        };
        object_say(from, help_messages[count]);
    }
    
    @JSONMethod
    public void HELP(User from) {
	String BureacratName = object().name().toLowerCase();
        switch(BureacratName) { 
            case "propertycrabot":
		send_reply_msg(from, "PROPERTY BUREAUCRAT: Say MOVE: <address> to change turfs, WHERE: for your address, VACANT: [street] for empty homes.");
                break;
            case "vottingscrabot":
		send_reply_msg(from, "VOTING BUREAUCRAT: Say HELP to get a list of voting/registration options.");
                break;
            case "messagescrabot":
		send_reply_msg(from, "MESSAGING BUREAUCRAT: Say HELP to get a list of messages you can send.");
                break;
	}
		
    }

    @Override
    public void run() {
        Region.tellEveryone(eventText, true);
        isRunning = false;
    }

    /* ------------------------------------------------------------------ *
     * PropertyCrabot: turf moving.                                       *
     *                                                                    *
     * MOVE: <address>  relocate to any vacant turf, no questions asked.  *
     * WHERE:           report your current address.                      *
     * VACANT: [street] list vacancies (bare form: counts per street).    *
     *                                                                    *
     * A turf is a Region with is_turf==true; it is vacant when its       *
     * `resident` is empty/missing (the same test the bridge's turf       *
     * assigner uses). Moving = set resident on the new turf (atomically, *
     * the update filter requires it still vacant), clear it on the old   *
     * one, and update avatar.turf.                                       *
     *                                                                    *
     * Region documents are read/written with a direct mongo client using *
     * targeted $set — the same style as bridge_v2's ensureTurfAssigned — *
     * because the ODB layer type-resolves context documents into live    *
     * Context objects, which can neither expose mod fields nor be safely *
     * re-encoded. If a region IS currently loaded (someone is inside),   *
     * its live Region mod is updated too, so a later context checkpoint  *
     * can't clobber the database change.                                 *
     * ------------------------------------------------------------------ */

    /** Lazily-opened direct mongo connection for turf-record surgery. */
    private static com.mongodb.MongoClient TurfMongo = null;

    private synchronized com.mongodb.client.MongoCollection<org.bson.Document> odbCollection() {
        if (TurfMongo == null) {
            String hostport = context().contextor().server().props().getProperty(
                "conf.context.odb.mongo.hostport", "127.0.0.1:27017");
            com.mongodb.MongoClientOptions opts = com.mongodb.MongoClientOptions.builder()
                .serverSelectionTimeout(3000)
                .socketTimeout(3000)
                .build();
            TurfMongo = new com.mongodb.MongoClient(
                new com.mongodb.ServerAddress(hostport), opts);
        }
        return TurfMongo.getDatabase("elko").getCollection("odb");
    }

    /** Mongo filter matching a vacant turf: resident missing or empty. */
    private static org.bson.conversions.Bson vacantFilter() {
        return com.mongodb.client.model.Filters.or(
            com.mongodb.client.model.Filters.exists("mods.0.resident", false),
            com.mongodb.client.model.Filters.eq("mods.0.resident", ""));
    }

    /**
     * Turn a player-typed address into a context ref, or null if unparseable.
     * "Baker St 221" -> context-Baker_St_221_interior; "Popustop 924" ->
     * context-Popustop.924; a raw "context-..." ref passes through.
     */
    static String addressToRef(String address) {
        address = address.trim();
        if (address.isEmpty()) return null;
        if (address.toLowerCase().startsWith("context-")) return address;
        String[] parts = address.split("\\s+");
        if (parts.length < 2) return null;
        String num = parts[parts.length - 1];
        if (!num.matches("[0-9]+")) return null;
        StringBuilder street = new StringBuilder();
        for (int i = 0; i < parts.length - 1; i++) {
            if (i > 0) street.append('_');
            street.append(parts[i]);
        }
        if (street.toString().equalsIgnoreCase("popustop")) {
            return "context-Popustop." + num;
        }
        return "context-" + street + "_" + num + "_interior";
    }

    /** Pretty-print a turf ref: context-Baker_St_221_interior -> "Baker St #221". */
    static String prettyTurf(String ref) {
        if (ref == null || ref.isEmpty() || ref.equals(Avatar.DEFAULT_TURF)) {
            return "no fixed address";
        }
        String s = ref.startsWith("context-") ? ref.substring(8) : ref;
        if (s.startsWith("Popustop.")) return "Popustop #" + s.substring(9);
        if (s.endsWith("_interior")) s = s.substring(0, s.length() - 9);
        int i = s.lastIndexOf('_');
        if (i > 0 && s.substring(i + 1).matches("[0-9]+")) {
            return s.substring(0, i).replace('_', ' ') + " #" + s.substring(i + 1);
        }
        return s.replace('_', ' ');
    }

    /** The street part of a turf ref, for grouping ("Baker St", "Popustop"). */
    private static String turfStreet(String ref) {
        String pretty = prettyTurf(ref);
        int i = pretty.lastIndexOf(" #");
        return i > 0 ? pretty.substring(0, i) : pretty;
    }

    /** Escape a ref for use inside an anchored mongo $regex (refs only need '.' escaped). */
    private static String regexQuote(String s) {
        return s.replace("\\", "\\\\").replace(".", "\\.");
    }

    private void turfcrat_MOVE(User from, Avatar avatar, String address) {
        String wantedRef = addressToRef(address);
        if (wantedRef == null) {
            object_say(from, noid, "Give me an address, like MOVE: Baker St 221 or MOVE: Popustop 924.");
            return;
        }
        try {
            // Case-insensitive exact-ref lookup, so typed casing never matters.
            org.bson.Document target = odbCollection().find(
                com.mongodb.client.model.Filters.regex(
                    "ref", "^" + regexQuote(wantedRef) + "$", "i")).first();
            if (target == null) {
                object_say(from, noid, "There is no such address.");
                return;
            }
            String ref = target.getString("ref");
            org.bson.Document mods0 = firstMod(target);
            String userRef = avatar.object().baseRef();
            if (ref.equals(avatar.turf)) {
                object_say(from, noid, "You already live at " + prettyTurf(ref) + ".");
                return;
            }
            // Prefer the live mod's view when the region is loaded right now.
            Region live = Region.RefToRegion.get(ref);
            boolean isTurf   = (live != null) ? live.is_turf
                : (mods0 != null && "Region".equals(mods0.getString("type"))
                   && mods0.getBoolean("is_turf", false));
            String  resident = (live != null)
                ? (live.resident == null ? "" : live.resident)
                : (mods0 == null ? "" : mods0.get("resident", ""));
            if (!isTurf) {
                object_say(from, noid, "That is not a home address.");
                return;
            }
            if (!resident.isEmpty() && !resident.equals(userRef)) {
                object_say(from, noid, "Sorry, " + prettyTurf(ref) + " is not available.");
                return;
            }
            // Claim atomically: the filter re-requires vacancy, so two movers
            // racing for the same house can't both win.
            long claimed = odbCollection().updateOne(
                com.mongodb.client.model.Filters.and(
                    com.mongodb.client.model.Filters.eq("ref", ref),
                    com.mongodb.client.model.Filters.or(
                        vacantFilter(),
                        com.mongodb.client.model.Filters.eq("mods.0.resident", userRef))),
                com.mongodb.client.model.Updates.set("mods.0.resident", userRef))
                .getModifiedCount();
            if (claimed == 0 && !resident.equals(userRef)) {
                object_say(from, noid, "Sorry, " + prettyTurf(ref) + " is not available.");
                return;
            }
            if (live != null) {
                live.resident = userRef;
                live.gen_flags[MODIFIED] = true;
            }
            // Release the old turf — only if it still points back at this user
            // (the filter makes a stale/foreign resident a no-op, healing any
            // mismatch the legacy bureaucrat left behind).
            String oldRef = avatar.turf;
            if (oldRef != null && !oldRef.isEmpty() && !oldRef.equals(Avatar.DEFAULT_TURF)) {
                odbCollection().updateOne(
                    com.mongodb.client.model.Filters.and(
                        com.mongodb.client.model.Filters.eq("ref", oldRef),
                        com.mongodb.client.model.Filters.eq("mods.0.resident", userRef)),
                    com.mongodb.client.model.Updates.set("mods.0.resident", ""));
                Region oldLive = Region.RefToRegion.get(oldRef);
                if (oldLive != null && userRef.equals(oldLive.resident)) {
                    oldLive.resident = "";
                    oldLive.gen_flags[MODIFIED] = true;
                }
            }
            avatar.turf = ref;
            avatar.gen_flags[MODIFIED] = true;
            avatar.checkpoint_object(avatar);
            object_say(from, noid, "Done! You now live at " + prettyTurf(ref) + ".");
            if (oldRef != null && !oldRef.isEmpty() && !oldRef.equals(Avatar.DEFAULT_TURF)) {
                object_say(from, noid, prettyTurf(oldRef) + " has been returned to the Housing Authority.");
            }
        } catch (Exception e) {
            trace_exception(e);
            object_say(from, noid, "The Housing Authority computer is down. Try again later.");
        }
    }

    /** The first entry of a raw region document's mods array, or null. */
    private static org.bson.Document firstMod(org.bson.Document doc) {
        Object mods = doc.get("mods");
        if (!(mods instanceof java.util.List) || ((java.util.List) mods).isEmpty()) return null;
        Object mods0 = ((java.util.List) mods).get(0);
        return (mods0 instanceof org.bson.Document) ? (org.bson.Document) mods0 : null;
    }

    private void turfcrat_VACANT(User from, String streetArg) {
        String street = streetArg.trim().replace('_', ' ');
        try {
            java.util.ArrayList<String> refs = new java.util.ArrayList<String>();
            for (org.bson.Document doc : odbCollection()
                     .find(com.mongodb.client.model.Filters.and(
                         com.mongodb.client.model.Filters.eq("mods.0.is_turf", true),
                         vacantFilter()))
                     .projection(com.mongodb.client.model.Projections.include("ref"))) {
                refs.add(doc.getString("ref"));
            }
            if (refs.isEmpty()) {
                object_say(from, noid, "There are no vacancies anywhere. The city is full!");
                return;
            }
            if (street.isEmpty()) {
                // Per-street counts, alphabetized, chunked into short lines.
                java.util.TreeMap<String, Integer> counts = new java.util.TreeMap<String, Integer>();
                for (String ref : refs) {
                    String key = turfStreet(ref);
                    Integer n = counts.get(key);
                    counts.put(key, n == null ? 1 : n + 1);
                }
                object_say(from, noid, "Vacancies by street (say VACANT: <street> for house numbers):");
                StringBuilder line = new StringBuilder();
                for (java.util.Map.Entry<String, Integer> entry : counts.entrySet()) {
                    String part = entry.getKey() + ": " + entry.getValue();
                    if (line.length() > 0 && line.length() + part.length() > 72) {
                        object_say(from, noid, line.toString());
                        line.setLength(0);
                    }
                    if (line.length() > 0) line.append(", ");
                    line.append(part);
                }
                if (line.length() > 0) object_say(from, noid, line.toString());
            } else {
                // House numbers on one street, capped to keep the reply short.
                final int MAX_LISTED = 15;
                String canonicalStreet = null;
                java.util.ArrayList<Integer> numbers = new java.util.ArrayList<Integer>();
                for (String ref : refs) {
                    String refStreet = turfStreet(ref);
                    if (!refStreet.equalsIgnoreCase(street)) continue;
                    canonicalStreet = refStreet;
                    String pretty = prettyTurf(ref);
                    int i = pretty.lastIndexOf('#');
                    if (i >= 0) numbers.add(Integer.parseInt(pretty.substring(i + 1)));
                }
                if (numbers.isEmpty()) {
                    object_say(from, noid, "No vacancies on " + street + ". Say VACANT: for all streets.");
                    return;
                }
                java.util.Collections.sort(numbers);
                StringBuilder line = new StringBuilder();
                for (int i = 0; i < numbers.size() && i < MAX_LISTED; i++) {
                    if (i > 0) line.append(", ");
                    line.append(numbers.get(i));
                }
                String more = numbers.size() > MAX_LISTED
                    ? " (and " + (numbers.size() - MAX_LISTED) + " more)" : "";
                object_say(from, noid, "Vacant on " + canonicalStreet + ": " + line + more);
            }
        } catch (Exception e) {
            trace_exception(e);
            object_say(from, noid, "The Housing Authority computer is down. Try again later.");
        }
    }
}
