const { first, runReadTool } = require('../lib/http');
module.exports = (req, res) => runReadTool(req, res, 'git_status', {
  root: first(req.query.root), repoPath: first(req.query.repoPath, '.')
});
