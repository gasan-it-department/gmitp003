export interface PagingProps {
  lastCursor: string | null;
  limit: string;
  query?: string;
  departId?: string;
  userId?: string;
  id?: string;
  inUnitOnly?: boolean;
}

export interface AddPositionProps {
  id: string;
  title: string;
  itemNumber: string | undefined;
  level: string;
  slotCount: string;
  plantilla: boolean;
  description: string | undefined;
  slot: {
    status: boolean;
    salaryGrade: string;
  }[];
}

export interface AnnouncementsProps {
  departmentId: string;
  important: boolean;
  line: string;
  lastCursor: string;
  limit: number;
}

export type AdminLoginProps = {
  username: string;
  password: string;
};

export type NewDataSetProps = {
  title: string;
  lineId: string;
  inventoryBoxId: string;
  userId: string;
};

export type AddBulkSupplyProps = {
  name: string;
};

export type AddNewSupplyProps = {
  item: string;
  description: string;
  lineId: string;
  suppliesDataSetId: string;
  consumable: boolean;
  userId: string;
  inventoryBoxId: string;
};

export type UpdateSupplyProps = {
  id: string;
  userId: string;
  inventoryBoxId: string;
  [key: string]: any;
};
