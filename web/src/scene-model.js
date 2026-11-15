/* 由 tools/testset.js fit 自動產生，請勿手動編輯。
 * 標註照片：40 張（美食 2、風景 13、延伸 12、物品 9；人像另由人臉判斷）
 * 產生時間：2026-11-15T15:36:13.280Z
 */
(function (root) {
  const model = {
    "features": [
      "horizon",
      "linesH",
      "linesV",
      "linesDiag",
      "vanish",
      "vanishInside",
      "symLR",
      "emptiness",
      "subjectConf",
      "subjectArea",
      "edgeDensity",
      "warmCenter",
      "brightness",
      "contrast"
    ],
    "use": [
      "emptiness",
      "linesDiag",
      "vanishInside",
      "subjectConf",
      "edgeDensity"
    ],
    "centroids": {
      "food": [
        0,
        0.2795,
        0.2468,
        0.4738,
        0.1117,
        0,
        0.3833,
        0.2429,
        0.0304,
        0.7794,
        0.9246,
        0.3002,
        0.5044,
        0.5272
      ],
      "landscape": [
        0.3846,
        0.2881,
        0.2647,
        0.4472,
        0.1429,
        0.0676,
        0.544,
        0.6069,
        0.2058,
        0.421,
        0.8618,
        0.0768,
        0.2803,
        0.3656
      ],
      "perspective": [
        0.1667,
        0.3462,
        0.2849,
        0.3688,
        0.1938,
        0.0812,
        0.4673,
        0.5284,
        0.1457,
        0.5997,
        0.9174,
        0.2292,
        0.3336,
        0.3902
      ],
      "object": [
        0.2222,
        0.3811,
        0.3217,
        0.2972,
        0.1981,
        0.0223,
        0.4033,
        0.3691,
        0.1694,
        0.8715,
        0.9249,
        0.2915,
        0.4085,
        0.4219
      ]
    },
    "std": [
      0.433,
      0.1304,
      0.1229,
      0.0947,
      0.0852,
      0.0777,
      0.1309,
      0.2003,
      0.1146,
      0.329,
      0.0799,
      0.2094,
      0.1168,
      0.1174
    ],
    "counts": {
      "food": 2,
      "landscape": 13,
      "perspective": 12,
      "object": 9
    },
    "temperature": 0.5
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = model;
  else root.PhotoriumSceneModel = model;
})(typeof window !== 'undefined' ? window : globalThis);
