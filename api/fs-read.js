const { first, intParam, runReadTool } = require('../lib/http');
module.exports = (req, res) => runReadTool(req, res, 'fs_read_text', {
  root: first(req.query.root), path: first(req.query.path),
  startLine: intParam(req.query.startLine, 1, 1, 10000000), maxLines: intParam(req.query.maxLines, 200, 1, 400)
});
