const { runReadTool } = require('../lib/http');
module.exports = (req, res) => runReadTool(req, res, 'vps_identity');
