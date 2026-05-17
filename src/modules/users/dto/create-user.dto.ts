export class CreateUserDto {
    firstName!: string;
    lastName!: string;
    email!: string;
    phone!: number;
    role!: "admin" | "receptionist" | "doctor" | "lab_technician";
    salary!: number;
}
