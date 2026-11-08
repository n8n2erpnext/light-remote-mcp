const { first, intParam, runReadTool } = require('../lib/http');
module.exports = (req, res) => runReadTool(req, res, 'fs_list', {
  root: first(req.query.root), path: first(req.query.path, '.'), depth: intParam(req.query.depth, 1, 1, 3)
});
