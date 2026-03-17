const express = require('express');
const preparedPostController = require('../controllers/preparedPostController');

const router = express.Router();

router.get('/ui', preparedPostController.getPreparedPostUi);
router.get('/queue', preparedPostController.getPreparedQueue);
router.get('/schedule', preparedPostController.getPreparedScheduleSettings);
router.post('/import', preparedPostController.importPreparedPosts);
router.post('/publish-now', preparedPostController.publishPreparedPostNow);
router.post('/upload', preparedPostController.uploadPreparedPosts);
router.delete('/day', preparedPostController.deletePreparedScheduledDay);
router.delete('/group', preparedPostController.deletePreparedPostGroup);
router.put('/group', preparedPostController.updatePreparedPostGroup);
router.put('/schedule', preparedPostController.updatePreparedScheduleSettings);

module.exports = router;
