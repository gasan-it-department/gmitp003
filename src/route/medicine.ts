import { FastifyInstance } from "../barrel/fastify";
import { authenticated, medicineAccessAuth } from "../middleware/handler";

import {
  medicineStorage,
  addMedicineStorage,
  medicineList,
  addStorageMed,
  medicineLogList,
  storageMeds,
  addStorageMedInList,
  storageMedList,
  newPrescriptionCount,
  medicineNotification,
  viewNotification,
} from "../controller/medicineController";

export const medicine = (fastify: FastifyInstance) => {
  fastify.get(
    "/medicine/storage",
    { preHandler: authenticated },
    medicineStorage
  );
  fastify.get("/medicine/logs", { preHandler: authenticated }, medicineLogList);
  fastify.post(
    "/medicine/storage/add-storage-location",
    { preHandler: authenticated },
    addMedicineStorage
  );
  fastify.get(
    "/medicine/storage-list",
    { preHandler: authenticated },
    medicineList
  );

  fastify.get("/medicine/items", { preHandler: authenticated }, storageMeds);
  fastify.get("/medicine/storage-item", storageMedList);

  fastify.post("/add-medicine", { preHandler: authenticated }, addStorageMed);
  fastify.post(
    "/storage/add-medicine",
    { preHandler: authenticated },
    addStorageMedInList
  );
  fastify.get(
    "/medicine/new/notif",
    { preHandler: authenticated },
    newPrescriptionCount
  );
  fastify.get(
    "/medicine/notifications",
    { preHandler: authenticated },
    medicineNotification
  );
  fastify.patch(
    "/medicine/notification/view",
    { preHandler: authenticated },
    viewNotification
  );
};
