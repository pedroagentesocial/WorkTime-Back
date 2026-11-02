export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface EmailSender {
  // Lanza si el proveedor rechaza el envio
  send(message: EmailMessage): Promise<void>;
}
