package org.made.neohabitat;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.json.Encodable;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;

/**
 * Class within which to serialize an Avatar's Mail queue.
 */
public class MailQueue implements Encodable {

    public String[] queue;

    @JSONMethod({ "queue" })
    public MailQueue(String[] queue) {
        if (queue == null) {
            this.queue = new String[0];
        } else {
            this.queue = queue;
        }
    }

    public MailQueue() {
        this.queue = new String[0];
    }

    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral paper = new JSONLiteral(control);
        if (control.toRepository()) {
            paper.addParameter("queue", queue);
        }
        return paper;
    }

    public void addNewMail(String mailRef) {
        String[] newQueue = new String[queue.length + 1];
        System.arraycopy(queue, 0, newQueue, 0, queue.length);
        newQueue[queue.length] = mailRef;
        queue = newQueue;
    }

    public String popNextMailRef() {
        if (queue.length == 0) {
            return null;
        }
        String[] newQueue = new String[queue.length - 1];
        System.arraycopy(queue, 1, newQueue, 0, queue.length - 1);
        String headMailRef = queue[0];
        queue = newQueue;
        return headMailRef;
    }

    public boolean empty() {
        return queue.length == 0;
    }

    public boolean nonEmpty() {
        return !empty();
    }

}
