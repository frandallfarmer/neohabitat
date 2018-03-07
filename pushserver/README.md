Neohabitat Exhibit Push Server
==============================

The Push Server is a combination of two separate services, designed to provide a
web-based guide to an Avatar's in-world experiences:

 - A proxy which tracks a session between an Avatar's client and the Elko-based game
   server.
 - An Express-based web application which handles the rendering of all guide pages and
   the sending of events.

Installation
------------

Dependencies are tracked using NPM. To install them, ensure you are running from the
```pushserver``` directory, then run the following command:

```bash
$ npm install
```

Running
-------

Several useful scripts are provided within this application's ```package.json```.

To run the server in **production** mode:

```bash
$ npm start
```

To run the server in **debug** mode:

```bash
$ npm run debug
```
