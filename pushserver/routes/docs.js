const fs = require('fs');

const express = require('express');
const log = require('winston');
const showdown = require('showdown');

const Helpfiles = require('../constants/helpfiles');


const RegionDocsDir = './public/docs/region/';
const RegionNotFoundLocation = RegionDocsDir + 'NOT_FOUND.md';

const HelpDocsDir = './public/docs/help/';
const HelpNotFoundLocation = HelpDocsDir + 'help.does.not.exist.md';


class DocsRoutes {
  constructor(habiproxy, config) {
    var self = this;

    self.habiproxy = habiproxy;
    self.config = config;
    self.mdConverter = new showdown.Converter();
    self.router = express.Router();

    fs.readFile(RegionNotFoundLocation, 'utf8', function(err, contents) {
      if (err) {
        log.error('Region not found doc failed to open: %s', err);
        self.regionNotFoundDoc = '<h1>No docs found.</h1>'
      } else {
        self.regionNotFoundDoc = self.mdConverter.makeHtml(contents);
      }
    });

    fs.readFile(HelpNotFoundLocation, 'utf8', function(err, contents) {
      if (err) {
        log.error('Region not found doc failed to open: %s', err);
        self.helpNotFoundDoc = '<h1>No docs found.</h1>'
      } else {
        self.helpNotFoundDoc = self.mdConverter.makeHtml(contents);
      }
    });

    self.setRoutes();
  }

  renderDocs(req, res, subject, mdDocLocation, htmlDocLocation, notFoundText) {
    var self = this;
    fs.readFile(mdDocLocation, 'utf8', function(err, mdContents) {
      if (err) {
        log.debug('Markdown docs for subject %s not found at %s: %s',
          subject, mdDocLocation, err);
        // Couldn't read the Markdown doc, attempts for an HTML doc.
        fs.readFile(htmlDocLocation, 'utf8', function(err, htmlContents) {
          if (err) {
            // File reading failed, renders /docs/region/NOT_FOUND.md.
            log.debug('HTML docs for subject %s not found at %s, showing NOT_FOUND: %s',
              subject, htmlDocLocation, err)
            res.render('docPage', {
              title: 'Docs - ' + subject,
              docPageBody: notFoundText,
              habiproxy: self.habiproxy,
            });
            return;
          }

          // An HTML doc page was located, so renders it.
          res.render('docPage', {
            title: 'Docs - ' + subject,
            docPageBody: htmlContents,
            habiproxy: self.habiproxy,
          });
        });
        return;
      }

      // A Markdown doc page was located, so renders it.
      res.render('docPage', {
        title: 'Docs - ' + subject,
        docPageBody: self.mdConverter.makeHtml(mdContents),
        habiproxy: self.habiproxy,
      });
    });
  }

  setRoutes() {
    var self = this;

    self.router.get('/region/:regionName', function(req, res, next) {
      var mdDocLocation   = RegionDocsDir + req.params.regionName + '.md';
      var htmlDocLocation = RegionDocsDir + req.params.regionName + '.html';
      self.renderDocs(
        req, res, req.params.regionName, mdDocLocation, htmlDocLocation,
        self.regionNotFoundDoc);
    });

    self.router.get('/help/:classNumber', function(req, res, next) {
      var classNumberInt = parseInt(req.params.classNumber);
      if (classNumberInt === NaN) {
        var err = new Error('Class number must be an Integer.');
        err.status = 400;
        next(err);
        return;
      }
      var mdDocLocation = HelpDocsDir + Helpfiles[classNumberInt];
      self.renderDocs(req, res, 'Object Help', mdDocLocation, mdDocLocation,
        self.helpNotFoundDoc);
    });
  }
}

module.exports = DocsRoutes;
