package org.made.neohabitat;

import org.elkoserver.json.*;
import org.elkoserver.server.context.User;

import org.made.neohabitat.mods.Paper;


/**
 * Represents a JSON-serializable Mail queue, used for facilitating
 * in-order delivery of Mail messages to Paper mods in Avatar
 * pockets.
 */
public class MailQueue implements Encodable {

    public MailQueueRecord[] queue;

    public MailQueue(JSONObject queueObj) throws JSONDecodingException {
        if (queueObj == null) {
            this.queue = new MailQueueRecord[0];
        } else {
            JSONArray queueRecordsArray = queueObj.getArray("queue");
            JSONObject[] queueRecords = {};
            queueRecords = queueRecordsArray.toArray(queueRecords);

            this.queue = new MailQueueRecord[queueRecords.length];
            for (int i=0; i < queue.length; i++) {
                this.queue[i] = new MailQueueRecord(queueRecords[i]);
            }
        }
    }

    public MailQueue() {
        this.queue = new MailQueueRecord[0];
    }

    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral paper = new JSONLiteral(control);
        if (control.toRepository()) {
            paper.addParameter("queue", getQueueAsJSONObjects());
        }
        paper.finish();
        return paper;
    }

    public void addNewMail(User from, Paper newMail) {
        MailQueueRecord[] newQueue = new MailQueueRecord[queue.length + 1];
        System.arraycopy(queue, 0, newQueue, 0, queue.length);
        newQueue[queue.length] = new MailQueueRecord(
            from.name().toLowerCase(), from.ref(), newMail.text_path,
            newMail.sent_timestamp);
        queue = newQueue;
    }

    public MailQueueRecord popNextMail() {
        if (empty()) {
            return null;
        }
        MailQueueRecord[] newQueue = new MailQueueRecord[queue.length - 1];
        System.arraycopy(queue, 1, newQueue, 0, queue.length - 1);
        MailQueueRecord headMailRef = queue[0];
        queue = newQueue;
        return headMailRef;
    }

    public boolean empty() {
        return queue.length == 0;
    }

    public boolean nonEmpty() {
        return !empty();
    }

    public int size() {
        return queue.length;
    }

    private JSONObject[] getQueueAsJSONObjects() {
        JSONObject[] jsonObjects = new JSONObject[queue.length];
        for (int i=0; i < queue.length; i++) {
            jsonObjects[i] = queue[i].toJSONObject();
        }
        return jsonObjects;
    }

}
