import { SupplyStockTrack, User } from "../barrel/prisma";
export interface PagingProps {
  lastCursor: string | null;
  limit: string;
  query?: string;
  departId?: string;
  userId?: string;
  id?: string;
  inUnitOnly?: boolean;
  [key: string]: unknown;
}

export interface AddPositionProps {
  id: string;
  title: string;
  designation: string | undefined;
  itemNumber: string | undefined;
  level: string;
  slotCount: string;
  plantilla: boolean;
  description: string | undefined;
  slot: {
    status: boolean;
    salaryGrade: string;
  }[];
  unitId: string;
  lineId: string;
  userId: string;
  exclusive: boolean;
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

export type DeleteOrderItemProps = {
  id: string;
  userId: string;
  inventoryBoxId: string;
  orderId: string;
};

export type UpdateOrderItem = {
  id: string;
  value: string;
  inventoryBoxId: string;
  desc: string | undefined;
};

export type DeleteOrderProps = {
  id: string;
  inventoryBoxId: string;
  userId: string;
};

export type SaveOrder = {
  id: string;
  userId: string;
  inventoryBoxId: string;
};

export type SupplyOverviewProps = {
  inventoryBoxId: string;
};

export type DeleteDataSetProps = {
  id: string;
  userId: string;
  inventoryBoxId: string;
};

export type DataProps = {
  id: string;
};

export type AddListAccess = {
  userId: string;
  listId: string;
  containerId: string;
};

export type DeleteListProps = {
  userId: string;
  containerId: string;
  id: string;
};

export type FullFillOrderProps = {
  inventoryBoxId: string;
  userId: string;
  orderId: string;
};

export type FullfilledItemOrderProps = {
  id: string;
  quantity: string;
  quality: string;
  perQuantity: number;
  brand?: string;
  condition: string;
  comments: string;
  price?: string;
  resolve: number;
  inventoryBoxId: string;
  listId: string;
  expirationDate: any;
  supplier: string;
  lineId: string;
  orderItemId: string;
};

export type SupplyListOverviewProps = {
  inventoryBoxId: string;
  listId: string;
  lastCursor: string | null;
  limit: string;
  query?: string;
};

export type DispenseItemProps = {
  id: string;
  userId?: string;
  unitId?: string;
  quantity: string;
  desc?: string;
  currUserId: string;
  remark: string;
  listId: string;
  inventoryBoxId: string;
};

export type TimebaseGroupPrice = {
  item: SupplyStockTrack;
  price: {
    first: number;
    second: number;
    third: number;
    fourth: number;
  };
};

export type PrescriptionProps = {
  id: string;
  refNumber: string;
  condtion?: string;
  firstname?: string;
  lastname?: string;
  street?: string;
  age: string;
  barangay: string;
  barangayId: string;
  municipal: string;
  municipalId: string;
  province: string;
  provinceId: string;
  userId: string;
  respondedByUserId?: string;
  status: number;
  comment: string;
  remark: number;
  lineId: string;
  desc: string;
  prescribeMed: {
    medId: string;
    quantity: string;
    comment: string;
  }[];
  unitId?: string;
};

export type PrescriptionDispenseProps = {
  id: string;
  userId: string;
  prescribeMed: {
    id: string;
    medId: string;
    quantity: number;
    remark: string;
    stockId: string;
    prescribeQuantity: number;
    stocks: { id: string; toRelease: number }[];
  }[];
};

export type PostNewJobProps = {
  id: string;
  userId: string;
  lineId: string;
  status: number;
  hideSG: boolean;
  showApplicationCount: boolean;
  location: string | undefined;
  positionId: string;
  desc: string;
  salaryGrade: string;
  deadline: string;
};

export type AddNewPostJobRequiementsProps = {
  postId: string;
};

// Educational
export type Educational = {
  name?: string;
  from: string;
  to: string;
  course: string;
  highestAttained: string;
  yearGraduate: string;
  records: string;
};

// Parent
export type Parent = {
  surname: string;
  firstname: string;
  middle?: string;
  occupation?: string;
  age?: string;
  birthdate?: Date;
  suffix?: string;
};

// Children
export type Children = {
  fullname: string;
  dateOfBirth?: Date;
  id: string;
};

// Eligibility
export type Eligibility = {
  id: string;
  title: string;
  rating?: string;
  dateExami?: string;
  placeOfExam: string;
  licenceNumber: string;
  licenceValidity?: Date;
};

// Work Experience
export type WorkExperience = {
  id: string;
  from: string;
  to: string;
  position: string;
  department: string;
  status: string;
  govService: boolean;
};

// Address
export type Address = {
  blockno?: string;
  street?: string;
  subVillage?: string;
  barangay: string;
  cityMunicipality: string;
  province: string;
  zipCode?: string;
};

// Citizenship
export type Citizenship = {
  filipino: boolean;
  dual: boolean;
  byBirth: boolean;
  byNaturalization: boolean;
  country?: string;
};

// Applicant Tags
export type ApplicantTags = {
  tag: string;
  cont: string;
};

// Main AddUser type (updated with proper types)
export type AddUser = {
  firstName: string;
  lastName: string;
  middleName?: string;
  suffix?: string;
  birthDate?: Date;
  email: string;
  gender: string;
  citizenship: Citizenship;
  civilStatus: string;
  residentialAddress: Address;
  permanentAddress: Address;
  telephoneNumber: string;
  mobileNo: string;
  height: string;
  weight: string;
  bloodType: string;
  umidNo?: string;
  pagIbigNo?: string;
  philHealthNo?: string;
  philSys?: string;
  tinNo?: string;
  agencyNo?: string;
  spouseSurname?: string;
  spouseFirstname?: string;
  spouseMiddle?: string;
  spouseBusinessAddress?: string;
  spouseTelephone?: string;
  father: Parent;
  mother: Parent;
  children: Children[];
  elementary?: Educational;
  secondary?: Educational;
  vocational?: Educational;
  college?: Educational;
  graduateCollege: Educational;
  civiService?: Eligibility[];
  experience?: WorkExperience[];
  tags: ApplicantTags[];
  assets?: Array<{
    file: File;
    title: string;
  }>;
};
export type ApplicationSubmissionProps = {
  id: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  suffix?: string;
  birthDate?: string;
  email: string;
  gender: string;
  citizenship: Citizenship;
  civilStatus: string;
  residentialAddress: Address;
  permanentAddress: Address;
  telephoneNumber: string;
  mobileNo: string;
  height: string;
  weight: string;
  bloodType: string;
  umidNo?: string;
  pagIbigNo?: string;
  philHealthNo?: string;
  philSys?: string;
  tinNo?: string;
  agencyNo?: string;
  spouseSurname?: string;
  spouseFirstname?: string;
  spouseMiddle?: string;
  spouseBusinessAddress?: string;
  spouseTelephone?: string;
  father: Parent;
  mother: Parent;
  children: Children[];
  elementary?: Educational;
  secondary?: Educational;
  vocational?: Educational;
  college?: Educational;
  graduateCollege: Educational;
  civiService?: Eligibility[];
  experience?: WorkExperience[];
  tags: ApplicantTags[];
  assets?: Array<{
    file: File;
    title: string;
  }>;
};

export type ApplicationConversation = {
  userId: string;
  message: string;
  applicationId: string;
};

export type UpdateApplicationStatus = {
  applicantId: string;
  userId: string;
  lineId: string;
  status: number;
};

export type NewAnnouncement = {
  id: string;
  title: string;
  content: string;
  lineId: string;
  mentions: string[];
  important: boolean;
  authorId: string;
};

export type PdfParsedData = {
  numPages: number;
  text: string;
  pages: PdfPage[];
  metadata: Record<string, any>;
  textStats: {
    totalCharacters: number;
    totalWords: number;
  };
};

export type PdfPage = {
  pageNumber: number;
  text: string;
  charCount: number;
};
