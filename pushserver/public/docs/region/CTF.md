# Capture The Flag

Welcome to the Capture The Flag arena!

Capture The Flag was planned to be the first Avatar sport.  It was intended to be played on a field consisting of several interconnected regions and was modeled on the human sport
of the same name.

Plans were made early on to introduce the game but by the time the pilot test was over, it remained unfinished.

As a result of this, only Field #3 is available to explore once you enter the Lobby. Fields #1 and #2 were not present in the database backup these regions have been taken from. It is assumed that they hadn't been created.

The original location for this region was where Fine Furniture currently is Downtown. Instead of disrupting the flow of the Downtown area, we decided to place it on the end of the I/5 specifically for NeoHabitat.

The idea was that there would be equal-sized teams of up to five Avatar players apiece. The five Avatar limit was deliberately set at the maximum region occupancy minus one, so that a team couldn't block a region simply by filling it with avatars.

Each team was intended to have a goal region that is at that team's end of the field. Each team was also meant to have a flag that starts the game in the team's goal region. Each goal region was meant to have a special magic button which would enable you to start or finish the game.

Originally, there were intended to be three sizes of play field. Small, medium and large which would consist of five, 12 and 30 regions respectively. The different sizes of field were due to the fact the team weren't sure how play would work out in practice and they wanted to experiment.

The playing area was meant to have an entrance region that directs passers-through to one of three exits which lead to the entrances to each of the three different fields.

Each field in turn was going to have a special entrance region with three exits. The three exits were for the blue team, the black team and spectators respectively.

Each of the team entrances connects to that team's goal region, while the spectator entrance connects to the middle of the field. The special entrance region was planned to make use of a sophisticated exit daemon which would handle the various exits to the field.

The spectator exit would've only allowed the passage of ghosts, with a special flag being set on the ghost to prohibit de-ghosting inside the playfield if they had passed through the spectator exit. Once you passed back into the team entrance, the flag would be removed so you could de-ghost once more.

The team exits would not have allowed the passage of any Avatar who was carrying anything in his/her hands or pockets. This was intended to prevent cheating by carrying weapons or magic items onto the field or by carrying large objects that would block field regions by filling the C64's memory.

It also meant that players wouldn't have been able to steal the flags from the field either.

Each team exit would've kept a count of the number of players on the field to ensure no more than five were allowed on a side at any one time.

Once an Avatar entered the field, the daemon would change their Avatar to be wearing their team colors for the duration of play. Their original colors would be restored upon exiting. Players were also not able to become ghosts during a match.

The actual gameplay itself was quite simple. The object was to grab the other team's flag, bring it back to your team's goal, and push the button. Pushing the button in the goal region while the other team's flag is present in the region would've scored a point.

It remained undecided whether scoring once would win the game, or whether Avatars would be allowed to play for a higher number of points.

**[Creator Anecdote](https://github.com/Museum-of-Art-and-Digital-Entertainment/habitat/blob/master/chip/habitat/docs/stuff.itr)**

~~~~

**December 15, 1986**

There are two unresolved design issues, one major and the other minor.  The
minor issue pertains to starting or resetting the game: we don't want the game
to start until each team is present in full and the two flags are in their
proper starting locations.

This is a minor issue, however, because although we would like to automate this process, it *can* be handled by the cooperation of the players themselves using ESP. The major issue pertains to score keeping: how do we announce to all the players when a team scores and, if more than one point is needed to win, where do we actually store the score of a game in progress?

Announcement can probably be handled using some form of synthetic ESP message.  Score keeping will require a special mechanism of as yet unknown nature.  However, we do expect it to be possible without undue difficulty.

~~~~

## Citations:
[https://github.com/Museum-of-Art-and-Digital-Entertainment/habitat/blob/master/chip/habitat/docs/stuff.itr](https://github.com/Museum-of-Art-and-Digital-Entertainment/habitat/blob/master/chip/habitat/docs/stuff.itr)
