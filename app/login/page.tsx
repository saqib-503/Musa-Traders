import type {Metadata} from "next";
import AuthForm from "@/components/AuthForm";
export const metadata:Metadata={title:"Login",robots:{index:false,follow:false}};
export default function Login(){return <AuthForm key="login" mode="login"/>;}
