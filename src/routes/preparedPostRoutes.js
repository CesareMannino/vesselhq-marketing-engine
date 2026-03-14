const express = require('express');
const preparedPostController = require('../controllers/preparedPostController');

const router = express.Router();

router.get('/ui', preparedPostController.getPreparedPostUi);
router.get('/queue', preparedPostController.getPreparedQueue);
router.post('/import', preparedPostController.importPreparedPosts);
router.post('/upload', preparedPostController.uploadPreparedPosts);
router.put('/group', preparedPostController.updatePreparedPostGroup);

module.exports = router;
