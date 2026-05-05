import { prisma, Prisma } from "../barrel/prisma";

export class Patient {
  public lastname: string;
  public firstname: string;
  public email: string | undefined;
  public phoneNumber: string | undefined;
  public lineId: string;

  constructor(
    lastname: string,
    firstname: string,
    lineId: string,
    email?: string,
    phoneNumber?: string,
  ) {
    this.lastname = lastname;
    this.firstname = firstname;
    this.email = email;
    this.phoneNumber = phoneNumber;
    this.lineId = lineId;
  }

  // Async create method to save patient to database
  async create(): Promise<Patient> {
    try {
      const patient = await prisma.patient.create({
        data: {
          lastname: this.lastname,
          firstname: this.firstname,
          email: this.email,
          phoneNumber: this.phoneNumber,
          lineId: this.lineId,
        },
      });

      // Update the current instance with the created data
      this.lastname = patient.lastname;
      this.firstname = patient.firstname;
      this.email = patient.email || undefined;
      this.phoneNumber = patient.phoneNumber || undefined;

      return this;
    } catch (error) {
      throw new Error(`Failed to create patient: ${(error as Error).message}`);
    }
  }

  // Static async method to find patient by ID
  static async findById(id: string): Promise<Patient | null> {
    try {
      const patient = await prisma.patient.findUnique({
        where: { id },
      });

      if (!patient) return null;

      return new Patient(
        patient.lastname,
        patient.firstname,
        patient.lineId,
        patient.email || undefined,
        patient.phoneNumber || undefined,
      );
    } catch (error) {
      throw new Error(`Failed to find patient: ${(error as Error).message}`);
    }
  }

  // Static async method to find all patients
  static async findAll(): Promise<Patient[]> {
    try {
      const patients = await prisma.patient.findMany();

      return patients.map(
        (p) =>
          new Patient(
            p.lastname,
            p.firstname,
            p.lineId,
            p.email || undefined,
            p.phoneNumber || undefined,
          ),
      );
    } catch (error) {
      throw new Error(`Failed to find patients: ${(error as Error).message}`);
    }
  }

  // Async method to update patient
  async update(): Promise<Patient> {
    try {
      const updated = await prisma.patient.update({
        where: { id: this.getId() }, // You'll need to store the ID in the class
        data: {
          lastname: this.lastname,
          firstname: this.firstname,
          email: this.email,
          phoneNumber: this.phoneNumber,
        },
      });

      return new Patient(
        updated.lastname,
        updated.firstname,
        updated.lineId,
        updated.email || undefined,
        updated.phoneNumber || undefined,
      );
    } catch (error) {
      throw new Error(`Failed to update patient: ${(error as Error).message}`);
    }
  }

  // Async method to delete patient
  async delete(id: string): Promise<void> {
    try {
      await prisma.patient.delete({
        where: { id },
      });
    } catch (error) {
      throw new Error(`Failed to delete patient: ${(error as Error).message}`);
    }
  }

  // Helper method to get ID (add id property to your class)
  private getId(): string {
    // You need to store the ID when creating/finding the patient
    // Add an 'id' property to the class if needed
    throw new Error("ID not stored. Add 'id' property to Patient class");
  }
}

// Alternative approach with static factory methods
export class PatientService {
  static async createPatient(
    lastname: string,
    firstname: string,
    lineId: string,
    email?: string,
    phoneNumber?: string,
  ): Promise<Patient> {
    const patient = new Patient(
      lastname,
      firstname,
      lineId,
      email,
      phoneNumber,
    );
    await patient.create();
    return patient;
  }

  static async getPatient(id: string): Promise<Patient | null> {
    return Patient.findById(id);
  }
}

// Usage example:
async function example() {
  // Create a new patient
  const patient = new Patient(
    "Doe",
    "John",
    "john@example.com",
    "123-456-7890",
  );
  await patient.create();
  console.log("Patient created:", patient);

  // Using static method to find by ID
  const foundPatient = await Patient.findById("some-id");
  if (foundPatient) {
    console.log("Patient found:", foundPatient);
  }

  // Find all patients
  const allPatients = await Patient.findAll();
  console.log("All patients:", allPatients);
}
