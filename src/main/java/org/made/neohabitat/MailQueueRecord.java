package org.made.neohabitat;

import org.elkoserver.json.*;


/**
 * Represents a sent Mail message within an Avatar's MailQueue.
 */
public class MailQueueRecord {

    public String sender_name;
    public String sender_ref;
    public String paper_ref;
    public int timestamp;

    public MailQueueRecord(
        String sender_name, String sender_ref, String paper_ref, int timestamp) {
        this.sender_name = sender_name;
        this.sender_ref = sender_ref;
        this.paper_ref = paper_ref;
        this.timestamp = timestamp;
    }

    public MailQueueRecord(JSONObject jsonObj) throws JSONDecodingException {
        this.sender_name = jsonObj.getString("sender_name");
        this.sender_ref = jsonObj.getString("sender_ref");
        this.paper_ref = jsonObj.getString("paper_ref");
        this.timestamp = jsonObj.getInt("timestamp");
    }

    public JSONObject toJSONObject() {
        JSONObject record = new JSONObject();
        record.addProperty("sender_name", sender_name);
        record.addProperty("sender_ref", sender_ref);
        record.addProperty("paper_ref", paper_ref);
        record.addProperty("timestamp", timestamp);
        return record;
    }

}
