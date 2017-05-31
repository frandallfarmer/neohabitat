function getPapersInRegion(regionName) {
  var paperObjs = db.odb.find({
    "in": "context-" + regionName,
    "mods.0.type": "Paper",
  });
  var papers = [];
  if (paperObjs) {
    paperObjs.forEach(function(paperObj) {
      var paperText = db.odb.findOne({
        "ref": "paper-" + paperObj.ref,
      });
      if (paperText) {
        papers.push(paperText);
      }
    });
  }
  return papers;
}
