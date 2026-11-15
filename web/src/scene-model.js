/* 由 tools/testset.js fit 自動產生，請勿手動編輯。
 * 標註照片：250 張（美食 27、風景 57、延伸 72、物品 60；人像另由人臉判斷）
 * 產生時間：2026-11-15T16:11:00.824Z
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
      "brightness",
      "warmCenter",
      "linesDiag",
      "linesV",
      "subjectArea",
      "vanish",
      "vanishInside"
    ],
    "centroids": {
      "food": [
        0.1852,
        0.3134,
        0.1914,
        0.4952,
        0.2419,
        0.02,
        0.4513,
        0.3332,
        0.0449,
        0.84,
        0.88,
        0.425,
        0.4838,
        0.4489
      ],
      "landscape": [
        0.3333,
        0.3224,
        0.2293,
        0.4483,
        0.1482,
        0.0916,
        0.5183,
        0.5441,
        0.2027,
        0.513,
        0.8802,
        0.0891,
        0.3183,
        0.387
      ],
      "perspective": [
        0.2222,
        0.326,
        0.2972,
        0.3768,
        0.2147,
        0.0881,
        0.4851,
        0.4503,
        0.1564,
        0.5929,
        0.9103,
        0.1581,
        0.3813,
        0.4499
      ],
      "object": [
        0.2667,
        0.3504,
        0.2718,
        0.3778,
        0.205,
        0.0561,
        0.4434,
        0.3689,
        0.1685,
        0.6004,
        0.9215,
        0.2519,
        0.4239,
        0.4356
      ]
    },
    "std": [
      0.4382,
      0.113,
      0.1057,
      0.0944,
      0.1047,
      0.1064,
      0.129,
      0.1851,
      0.1259,
      0.3284,
      0.0788,
      0.1968,
      0.1076,
      0.1012
    ],
    "counts": {
      "food": 27,
      "landscape": 57,
      "perspective": 72,
      "object": 60
    },
    "temperature": 0.5
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = model;
  else root.PhotoriumSceneModel = model;
})(typeof window !== 'undefined' ? window : globalThis);
