/**
 * Birthday surprise settings.
 *
 * Change the name, message, photographs, colors, and timing here.
 * Photographs live in the photos/ folder. Use .jpg, .png, .webp, or .svg.
 * The animation places them for you — do not add frames or borders to the files.
 *
 * Preview a moment without watching the whole film:
 *   http://localhost:5173/?at=18     flower open, butterfly emerging
 *   http://localhost:5173/?at=36     photo journey
 *   http://localhost:5173/?at=60     birthday reveal
 */

export const config = {
  recipient: "Avery",

  // Spaces become separate lines.
  heading: "HAPPY BIRTHDAY",

  message:
    "For Ananya — may this year open the way the flower did,\nand carry you as lightly as the wings do.",

  // Ordered along the butterfly's flight. The first image appears first.
  photos: [
    "photos/abhay/pic1.jpg",
    "photos/abhay/pic2.jpg",
    "photos/abhay/pic3.jpg",
    "photos/abhay/pic4.jpg",
    "photos/abhay/pic5.jpg",
    "photos/abhay/pic6.jpg",
  ],

  // Seconds. The whole piece is the sum of these.
  timing: {
    dawn: 1.6,
    flower: 3.5,
    emerge: 1.2,
    hover: 1.8,
    journey: 8.5,
    ascend: 1,
    burst: 1.2,
  },

  colors: {
    sky: "#03030b",
    skyLift: "#140a1c",
    soilGlow: "#1a0c18",
    heading: "#fff8ee",
    message: "rgba(255, 244, 252, 0.88)",
    // Trail and burst. Cyan, violet, pink, and gold — the bridge between the two films.
    trail: [
      [120, 245, 255],
      [90, 150, 255],
      [210, 120, 255],
      [255, 130, 210],
      [255, 214, 140],
    ],
  },
};
