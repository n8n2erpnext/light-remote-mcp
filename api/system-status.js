const { runReadTool } = require('../lib/http');
module.exports = (req, res) => runReadTool(req, res, 'system_status');
