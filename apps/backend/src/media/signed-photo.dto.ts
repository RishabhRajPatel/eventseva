import { IsInt, IsString, Matches, MaxLength, Min } from 'class-validator';

/** A photo the vendor uploaded, with the fields of Cloudinary's signed reply (checked on the server). */
export class SignedPhotoDto {
  @IsString() @MaxLength(255) publicId: string;
  @IsInt() @Min(1) version: number;
  @IsString() @Matches(/^[0-9a-f]{40}$/i) signature: string;
}
