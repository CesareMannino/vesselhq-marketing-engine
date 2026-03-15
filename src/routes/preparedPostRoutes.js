const express = require('express');
const preparedPostController = require('../controllers/preparedPostController');

const router = express.Router();

router.get('/ui', preparedPostController.getPreparedPostUi);
router.get('/queue', preparedPostController.getPreparedQueue);
router.post('/import', preparedPostController.importPreparedPosts);
router.post('/publish-now', preparedPostController.publishPreparedPostNow);
router.post('/upload', preparedPostController.uploadPreparedPosts);
router.delete('/group', preparedPostController.deletePreparedPostGroup);
router.put('/group', preparedPostController.updatePreparedPostGroup);

module.exports = router;
