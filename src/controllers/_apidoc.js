/**
 * @apiDefine InvalidUriParameterError
 *
 * @apiError InvalidUriParameterError (One of) the provided URI parameter(s)
 *   was invalid.
 *
 * @apiErrorExample InvalidUriParameterError
 *     HTTP/1.1 400 Bad Request
 *     {
 *       "id": "InvalidUriParameterError",
 *       "message": "Error description here.",
 *       "validationErrors": [ ... ]
 *     }
 */

 /**
 * @apiDefine InvalidBodyError
 *
 * @apiError InvalidBodyError The submitted JSON entity does not match the
 *   required schema.
 *
 * @apiErrorExample InvalidBodyError
 *     HTTP/1.1 400 Bad Request
 *     {
 *       "id": "InvalidBodyError",
 *       "message": "Error description here.",
 *       "validationErrors": [ ... ]
 *     }
 */

 /**
 * @apiDefine UnacceptableExpiryError
 *
 * @apiError UnacceptableExpiryError Insufficient time between the destination and source expiry duration to ensure transfers can be executed in time.
 *
 * @apiErrorExample UnacceptableExpiryError
 *     HTTP/1.1 422 Bad Request
 *     {
 *       "id": "UnacceptableExpiryError",
 *       "message": "The difference between the destination expiry duration and the source expiry duration is insufficient to ensure that we can execute the source transfers."
 *     }
 */

 /**
 * @apiDefine AssetsNotTradedError
 *
 * @apiError AssetsNotTradedError The connector does not facilitate payments between the given currency pair.
 *
 * @apiErrorExample AssetsNotTradedError
 *     HTTP/1.1 422 Bad Request
 *     {
 *       "id": "AssetsNotTradedError",
 *       "message": "Error description here."
 *     }
 */

 /**
 * @apiDefine UnacceptableRateError
 *
 * @apiError UnacceptableRateError The rate proposed does not match the one currently offered.
 *
 * @apiErrorExample UnacceptableRateError
 *     HTTP/1.1 422 Bad Request
 *     {
 *       "id": "UnacceptableRateError",
 *       "message": "Error description here."
 *     }
 */
