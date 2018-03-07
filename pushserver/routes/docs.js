const fs = require('fs');

const express = require('express');
const log = require('winston');
const showdown = require('showdown');


const RegionDocsDir = './public/docs/region/';
const RegionNotFoundLocation = RegionDocsDir + 'NOT_FOUND.md';


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

    self.setRoutes();
  }

  setRoutes() {
    var self = this;
    self.router.get('/region/:regionName', function(req, res, next) {
      var mdDocLocation   = RegionDocsDir + req.params.regionName + '.md';
      var htmlDocLocation = RegionDocsDir + req.params.regionName + '.html';
      fs.readFile(mdDocLocation, 'utf8', function(err, mdContents) {
        if (err) {
          log.debug('Docs for region %s not found at %s: %s',
            req.params.regionName, mdDocLocation, err);
          fs.readFile(htmlDocLocation, 'utf8', function(err, htmlContents) {
            if (err) {
              // File reading failed, renders /docs/region/NOT_FOUND.md.
              log.info('Docs for region %s not found at %s, showing NOT_FOUND.md: %s',
                req.params.regionName, htmlDocLocation, err)
              res.render('docPage', {
                title: 'Region Docs - ' + req.params.regionName,
                docPageBody: self.regionNotFoundDoc,
                habiproxy: self.habiproxy,
              });
              return;
            }

            // An HTML doc page was located, so renders it.
            res.render('docPage', {
              title: 'Region Docs - ' + req.params.regionName,
              docPageBody: htmlContents,
              habiproxy: self.habiproxy,
            });
          });
          return;
        }

        // A Markdown doc page was located, so renders it.
        res.render('docPage', {
          title: 'Region Docs - ' + req.params.regionName,
          docPageBody: self.mdConverter.makeHtml(mdContents),
          habiproxy: self.habiproxy,
        });
      });
    });
  }
}

module.exports = DocsRoutes;
