// Relative, not @/: the web's tests import this file.
import { IMAGE_EXTENSIONS } from "../../lib/dashboard/attachments"

// The only names a screenshot is kept under, so the only ids the API serves: a random UUID and the image extension its bytes gave.
export const IMAGE_ID = new RegExp(
  `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(?:${IMAGE_EXTENSIONS.join("|")})$`,
)
