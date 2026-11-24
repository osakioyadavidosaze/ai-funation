import {
  FaceLandmarker,
  type FaceLandmarkerResult,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";

type Point = { x: number; y: number };

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function getBlendshape(
  result: FaceLandmarkerResult | undefined,
  category: string,
) {
  return (
    result?.faceBlendshapes?.[0]?.categories.find(
      (item) => item.categoryName === category,
    )?.score ?? 0
  );
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function pointSet(connections: { start: number; end: number }[]) {
  return new Set(connections.flatMap(({ start, end }) => [start, end]));
}

function facePose(landmarks: NormalizedLandmark[] | undefined) {
  if (!landmarks) return { yaw: 0, pitch: 0, roll: 0, offsetX: 0, offsetY: 0 };
  const leftEye = landmarks[33];
  const rightEye = landmarks[263];
  const nose = landmarks[1];
  const mouth = landmarks[13];
  if (!leftEye || !rightEye || !nose || !mouth) {
    return { yaw: 0, pitch: 0, roll: 0, offsetX: 0, offsetY: 0 };
  }

  const eyeDistance = Math.max(0.001, Math.hypot(
    rightEye.x - leftEye.x,
    rightEye.y - leftEye.y,
  ));
  const eyeCenter = midpoint(leftEye, rightEye);
  const yaw = clamp(((nose.x - eyeCenter.x) / eyeDistance) * 2.5, -1, 1);
  const eyeToMouth = Math.max(0.001, mouth.y - eyeCenter.y);
  const nosePosition = (nose.y - eyeCenter.y) / eyeToMouth;
  const pitch = clamp((nosePosition - 0.48) * 2.5, -1, 1);
  const roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);

  return {
    yaw,
    pitch,
    roll,
    offsetX: (nose.x - 0.5) * -0.16,
    offsetY: (nose.y - 0.5) * -0.12,
  };
}

function sampleSkinColor(
  image: HTMLImageElement,
  landmarks: NormalizedLandmark[],
) {
  const sampler = document.createElement("canvas");
  sampler.width = image.naturalWidth;
  sampler.height = image.naturalHeight;
  const sampleContext = sampler.getContext("2d", { willReadFrequently: true });
  if (!sampleContext) return "rgba(190, 145, 125, 0.94)";
  sampleContext.drawImage(image, 0, 0);

  const samples = [landmarks[205], landmarks[425]]
    .filter((point): point is NormalizedLandmark => Boolean(point))
    .map((point) => {
      const x = clamp(Math.round(point.x * sampler.width), 0, sampler.width - 1);
      const y = clamp(Math.round(point.y * sampler.height), 0, sampler.height - 1);
      return sampleContext.getImageData(x, y, 1, 1).data;
    });
  if (!samples.length) return "rgba(190, 145, 125, 0.94)";

  const channels = [0, 1, 2].map((channel) =>
    Math.round(samples.reduce((sum, sample) => sum + sample[channel], 0) / samples.length),
  );
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, 0.96)`;
}

const skinColors = new WeakMap<HTMLImageElement, string>();

function drawFeatureMesh(
  context: CanvasRenderingContext2D,
  points: Point[],
  lineWidth: number,
) {
  const featureConnections = [
    ...FaceLandmarker.FACE_LANDMARKS_LIPS,
    ...FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
    ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
    ...FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW,
    ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
    ...FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
  ];

  context.save();
  context.strokeStyle = "rgba(103, 232, 249, 0.38)";
  context.lineWidth = lineWidth;
  context.beginPath();
  for (const { start, end } of featureConnections) {
    const from = points[start];
    const to = points[end];
    if (!from || !to) continue;
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
  }
  context.stroke();
  context.restore();
}

function drawMouth(
  context: CanvasRenderingContext2D,
  points: Point[],
  openness: number,
  scale: number,
) {
  if (openness < 0.08) return;
  const left = points[61];
  const right = points[291];
  const upper = points[13];
  const lower = points[14];
  if (!left || !right || !upper || !lower) return;

  const center = midpoint(upper, lower);
  const width = Math.hypot(right.x - left.x, right.y - left.y) * 0.68;
  const opening = Math.max(2 / scale, width * openness * 0.42);

  context.save();
  context.translate(center.x, center.y + opening * 0.12);
  context.fillStyle = "#250a10";
  context.beginPath();
  context.ellipse(0, 0, width / 2, opening / 2, 0, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "rgba(242, 226, 211, 0.9)";
  context.beginPath();
  context.ellipse(0, -opening * 0.28, width * 0.31, opening * 0.12, 0, Math.PI, 0);
  context.fill();

  context.fillStyle = "rgba(176, 63, 83, 0.82)";
  context.beginPath();
  context.ellipse(0, opening * 0.31, width * 0.24, opening * 0.13, 0, 0, Math.PI);
  context.fill();
  context.restore();
}

function drawBlink(
  context: CanvasRenderingContext2D,
  points: Point[],
  connections: { start: number; end: number }[],
  blink: number,
  skinColor: string,
  scale: number,
) {
  if (blink < 0.35) return;
  const indexes = Array.from(pointSet(connections));
  const eyePoints = indexes.map((index) => points[index]).filter(Boolean);
  if (eyePoints.length < 4) return;

  const minX = Math.min(...eyePoints.map((point) => point.x));
  const maxX = Math.max(...eyePoints.map((point) => point.x));
  const minY = Math.min(...eyePoints.map((point) => point.y));
  const maxY = Math.max(...eyePoints.map((point) => point.y));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const radiusX = (maxX - minX) * 0.55;
  const radiusY = Math.max((maxY - minY) * 1.2, radiusX * 0.16);

  context.save();
  context.globalAlpha = clamp(blink * 1.15, 0, 1);
  context.fillStyle = skinColor;
  context.beginPath();
  context.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "rgba(70, 38, 42, 0.8)";
  context.lineWidth = 1.5 / scale;
  context.beginPath();
  context.moveTo(minX, centerY);
  context.quadraticCurveTo(centerX, centerY + radiusY * 0.45, maxX, centerY);
  context.stroke();
  context.restore();
}

export function drawAnimatedAvatar(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  portraitLandmarks: NormalizedLandmark[] | null,
  result: FaceLandmarkerResult | undefined,
  driverLandmarks: NormalizedLandmark[] | undefined,
  width: number,
  height: number,
) {
  const fit = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const pose = facePose(driverLandmarks);
  const yawScale = 1 - Math.abs(pose.yaw) * 0.16;
  const pitchScale = 1 - Math.abs(pose.pitch) * 0.07;
  const scale = fit * Math.min(yawScale, pitchScale);

  context.save();
  context.translate(
    width / 2 + pose.offsetX * width,
    height / 2 + pose.offsetY * height,
  );
  context.rotate(pose.roll);
  context.scale(fit * yawScale, fit * pitchScale);
  context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);

  if (!portraitLandmarks) {
    context.restore();
    return;
  }

  const points = portraitLandmarks.map((landmark) => ({
    x: landmark.x * image.naturalWidth - image.naturalWidth / 2,
    y: landmark.y * image.naturalHeight - image.naturalHeight / 2,
  }));
  const mouthIndexes = pointSet(FaceLandmarker.FACE_LANDMARKS_LIPS);
  const mouthTop = points[13];
  const mouthBottom = points[14];
  const mouthCenterY = mouthTop && mouthBottom
    ? (mouthTop.y + mouthBottom.y) / 2
    : 0;
  const jawOpen = getBlendshape(result, "jawOpen");
  const mouthWidth = points[61] && points[291]
    ? Math.hypot(points[291].x - points[61].x, points[291].y - points[61].y)
    : image.naturalWidth * 0.12;

  for (const index of Array.from(mouthIndexes)) {
    const point = points[index];
    if (!point) continue;
    const direction = point.y < mouthCenterY ? -1 : 1;
    point.y += direction * jawOpen * mouthWidth * (direction < 0 ? 0.08 : 0.2);
  }

  const leftBlink = getBlendshape(result, "eyeBlinkLeft");
  const rightBlink = getBlendshape(result, "eyeBlinkRight");
  const eyeConnections = [
    FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
    FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
  ];
  for (const [connections, blink] of [
    [eyeConnections[0], leftBlink],
    [eyeConnections[1], rightBlink],
  ] as const) {
    const indexes = Array.from(pointSet(connections));
    const eyePoints = indexes.map((index) => points[index]).filter(Boolean);
    const centerY = eyePoints.reduce((sum, point) => sum + point.y, 0) / Math.max(1, eyePoints.length);
    for (const index of indexes) {
      const point = points[index];
      if (!point) continue;
      point.y += (centerY - point.y) * blink * 0.82;
    }
  }

  const browRaise = clamp(
    getBlendshape(result, "browInnerUp") +
      (getBlendshape(result, "browOuterUpLeft") +
        getBlendshape(result, "browOuterUpRight")) *
        0.5,
    0,
    1,
  );
  const browIndexes = pointSet([
    ...FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW,
    ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
  ]);
  for (const index of Array.from(browIndexes)) {
    const point = points[index];
    if (point) point.y -= browRaise * image.naturalWidth * 0.025;
  }

  let skinColor = skinColors.get(image);
  if (!skinColor) {
    skinColor = sampleSkinColor(image, portraitLandmarks);
    skinColors.set(image, skinColor);
  }

  drawMouth(context, points, jawOpen, scale);
  drawBlink(
    context,
    points,
    FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
    leftBlink,
    skinColor,
    scale,
  );
  drawBlink(
    context,
    points,
    FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
    rightBlink,
    skinColor,
    scale,
  );
  drawFeatureMesh(context, points, 1 / scale);
  context.restore();
}

export function drawSyntheticLabel(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  const padding = Math.max(6, Math.round(width * 0.012));
  const fontSize = Math.max(10, Math.round(width * 0.018));
  const label = "SYNTHETIC AVATAR";
  context.font = `600 ${fontSize}px Arial`;
  const labelWidth = context.measureText(label).width;
  const badgeWidth = labelWidth + padding * 3 + fontSize;
  const badgeHeight = fontSize + padding * 2;
  const x = padding;
  const y = height - badgeHeight - padding;

  context.fillStyle = "rgba(12, 14, 22, 0.82)";
  context.beginPath();
  context.roundRect(x, y, badgeWidth, badgeHeight, badgeHeight / 2);
  context.fill();
  context.fillStyle = "#facc15";
  context.beginPath();
  context.arc(x + padding + fontSize / 2, y + badgeHeight / 2, fontSize / 3, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#ffffff";
  context.textBaseline = "middle";
  context.fillText(label, x + padding * 2 + fontSize, y + badgeHeight / 2);
  context.restore();
}
