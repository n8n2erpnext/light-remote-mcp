const { first, boolParam, runReadTool } = require('../lib/http');
module.exports = (req, res) => runReadTool(req, res, 'git_diff', {
  root: first(req.query.root), repoPath: first(req.query.repoPath, '.'),
  path: first(req.query.path, ''), cached: boolParam(req.query.cached)
});
