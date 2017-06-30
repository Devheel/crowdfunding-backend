const sharp = require('sharp')

const IMAGE_SIZE_SMALL = 384
const IMAGE_SIZE_SHARE = 1000

module.exports.IMAGE_SIZE_SMALL = IMAGE_SIZE_SMALL
module.exports.IMAGE_SIZE_SHARE = IMAGE_SIZE_SHARE

module.exports.toJPEG = (buffer) => {
  return sharp(buffer)
    .rotate()
    .jpeg({
      quality: 100
    })
    .toBuffer()
}

module.exports.toSmallBW = (buffer) => {
  return sharp(buffer)
    .rotate()
    .resize(IMAGE_SIZE_SMALL, IMAGE_SIZE_SMALL)
    .greyscale()
    .jpeg()
    .toBuffer()
}

module.exports.toShare = (buffer) => {
  return sharp(buffer)
    .rotate()
    .resize(IMAGE_SIZE_SHARE, IMAGE_SIZE_SHARE)
    .greyscale()
    .jpeg({
      quality: 100
    })
    .toBuffer()
}

module.exports.toWidth = (buffer, width) => {
  return sharp(buffer)
    .rotate()
    .resize(width, null)
    .jpeg()
    .toBuffer()
}
