package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Coinop;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;

/**
 * Habitat Fortune_machine Mod
 *
 * Fortune_machine returns a randomly-chosen fortune for the cost of 2 tokens.
 *
 * @author steve
 */
public class Fortune_machine extends Coinop implements Copyable {

    public int HabitatClass() {
        return CLASS_FORTUNE_MACHINE;
    }

    public String HabitatModName() {
        return "Fortune_machine";
    }

    public int capacity() {
        return 0;
    }

    public int pc_state_bytes() {
        return 0;
    };

    public boolean known() {
        return true;
    }

    public boolean opaque_container() {
        return false;
    }

    public boolean filler() {
        return false;
    }

    // A fortune costs 2 tokens.
    public static final int FORTUNE_COST = 2;
    public static final int FORTUNE_SFX_ID = 6;

    public static final String[] SIGNIFICANT_MESSAGES = new String[] {
        "* You might have mail in your pocket *",
        "You will receive mail today.",
        "Someone needs your help.",
        "Have a Choke and a Smile.",
        "Never give a sucker an even break.",
        "Find the 'Tome of Wealth And Fame' and receive big $$$!",
        "It is rumored that there is buried treasure on Dnalsi Island.",
        "Watch out for the curse of the Smiley Face!!",
        "The Habitat Stock Market is about to crash.  Sell all your stocks.",
        "Don't use the 'Ports today.  They are on the blink.",
        "Kiss the first Avatar of the opposite sex you meet today.",
        "There has been a run on the banks.  Better keep all of your cash on hand.",
        "VenDroid with exotic heads in the forest in the Woods near Populopolis.",
        "A wise man lives in the Back-Forty, Populopolis.  Look for the puff-balls.",
        "Orange, Lemon, Bar.  You lose.",
        "Lemon, Lemon, Cherry.  You lose.",
        "Bar, Bar, Cherry.  You lose.",
        "Bar, Orange, Cherry.  You lose.",
        "Something interesting that way ->",
        "<- Something interesting that way",
        "Someone is watching you. Be careful what you do.",
        "The Habitat Stock Market is about to get VERY bullish.  Invest NOW!",
        "The Habitat Stock Market is about to get VERY bearish.  Divest NOW!",
        "You have a secret admirer.",
        "Be careful today.  You may be robbed.",
        "You are industrious, creative and good looking.  Tell someone about it.",
        "You should have a sex change right away.  It will give you a new outlook on life.",
        "The Oracle loves you.",
        "Sorry, out of order.  Try again tomorrow.",
        "You are wise, compassionate and kind.  BUZZ OFF!",
        "Use ESP to contact a friend.  You'll be glad you did.",
        "FortuneDroid.  Habitat (c) Copyright 1987 Lucasfilm Games.",
        "The next Avatar you meet will be out to get you!",
        "Read the Tome of the Blue Mold.  A secret is hidden within.",
        "Habitat is for people who can't deal with Reality.",
        "Reality is for people who can't deal with Habitat.",
        "ESP from: The Oracle                   You are in BIG trouble.",
        "Fatal error trap.  Beep Beep Beep!  Woopa Woopa!  What in blazes did you do?",
        "You will be successful in your next adventure.",
        "Your best friend has more $ than you do.",
        "Redecorate your turf.  It'll make you feel better.",
        "Magic is the key to success.",
        "Open your own business.  You could turn a profit.",
        "Tonight is your lucky night!",
        "You are due for some bad luck.  Be VERY careful.",
        "Robbery is a real problem.  Be sure to lock everything up tight.",
        "The pawn shop is paying good $ for that stuff you've been trying to dump.",
        "Isn't this better than People Connection?",
        "System bouncing in 5 minutes.",
        "The Oracle is a fink!",
        "Uijt tfdsfu nfttbhf jt jm dpef.",
        "You need a new head.",
        "Don't change into a ghost today.  If you do, you may stay that way FOREVER!",
        "Everyone is out to get you.",
        "Desert Heart",
        "You are about to be nominated for the 10 Best-Dressed Avatars list.",
        "Be sure to carry a gun the next time you leave the city.",
        "See the world!  Travel to another city.",
        "There was a major magic accident in the Back Forty, near Populopolis.",
        "You will soon be a great wizard.",
        "You will soon be a great traveller.",
        "You will soon be a great politician.",
        "You will soon be a great sex symbol.",
        "You will soon be VERY popular.",
        "Feed Me!  More Coins!  More Coins!",
        "Coin detected in hand.  Please insert coin.",
        "Change your body color.",
        "I don't care what other people say.  You are attractive the way you are.",
        "You will lose your life soon.",
        "Scare a friend.  Walk around without your head.",
        "There is a plot to kill the current leader.  You must prevent it!",
        "Clue #47: The bird flies from the east.  Your arms fall off.",
        "Have you ever noticed that you can never open the windows?",
        "The mail system is getting overloaded.  Institute mail rationing.",
        "Beware of the INSECT PLAGUE.",
        "Beware of the Mutant.",
        "Meet the designers of MegaDeath in the Auditorium",
        "Buy Rabbit Jack's Casino.  It's great!",
        "Someone has something important for you.",
        "Someone is looking for you.",
        "Someone is hunting for you.  Best get out of town.",
        "True love is on the horizon.",
        "You look sick.  Better take a pill.",
        "Good fortune is headed your way.",
        "Bad luck is headed your way.",
        "Help!  The Oracle is holding me captive in this FortuneDroid!",
        "I am being held prisoner in a FortuneDroid factory.",
        "All is discovered.  Flee while you can.",
        "These aren't the 'droids you're looking for.  Move along.",
        "great idea for a fortune message"
    };

    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "take" })
    public Fortune_machine(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation,
        OptInteger gr_state, OptInteger take) {
        super(style, x, y, orientation, gr_state, take);
    }

    public Fortune_machine(int style, int x, int y, int orientation, int gr_state, int take) {
        super(style, x, y, orientation, gr_state, take);
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Fortune_machine(style, x, y, orientation, gr_state, take);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCoinop(new JSONLiteral(HabitatModName(), control));
        result.finish();
        return result;
    }

    @JSONMethod
    public void PAY(User from) {
        Avatar avatar = avatar(from);
        int	success = Tokens.spend(from, FORTUNE_COST);
        String text;
        if (success == TRUE) {
            text = getFortune();
            send_neighbor_msg(from, noid, "PAYTO$",
                "payer", avatar.noid,
                "amount_lo", FORTUNE_COST,
                "amount_hi", 0);
            send_neighbor_msg(from, THE_REGION, "PLAY_$",
                "sfx_number", sfx_number(FORTUNE_SFX_ID),
                "from_noid", noid);
            send_neighbor_msg(from, THE_REGION, "OBJECTSPEAK_$",
                "speaker", noid,
                "text", text);
            addToTake(FORTUNE_COST);
        } else {
            text = String.format("You don't have enough money.  Fortunes cost $%d.", FORTUNE_COST);
        }
        send_reply_msg(from, noid,
            "err", success,
            "amount_lo", FORTUNE_COST,
            "amount_hi", 0,
            "text", text);
    }

    private String getFortune() {
        return SIGNIFICANT_MESSAGES[rand.nextInt(SIGNIFICANT_MESSAGES.length)];
    }

}
