const { first, intParam, runReadTool } = require('../lib/http');
module.exports = (req, res) => runReadTool(req, res, 'fs_search', {
  root: first(req.query.root), path: first(req.query.path, '.'), query: first(req.query.query),
  maxResults: intParam(req.query.maxResults, 40, 1, 80)
});
