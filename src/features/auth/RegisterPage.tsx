import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { signUpSchema, type SignUpValues } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

export default function RegisterPage() {
  const navigate = useNavigate();
  const form = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { full_name_en: "", email: "", password: "", confirmPassword: "" },
  });

  const onSubmit = async (values: SignUpValues) => {
    const { data, error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: {
        data: { full_name_en: values.full_name_en },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      toast.error(errMsg(error));
      return;
    }
    if (data.session) {
      toast.success("Account created — welcome!");
      navigate("/dashboard", { replace: true });
    } else {
      toast.success("Account created! Please verify your email using the link we sent you.");
      navigate("/login", { replace: true });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Create your account</CardTitle>
        <CardDescription>
          Join the ICPC SGU Community — Level 1 training program.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="full_name_en"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full name (English)</FormLabel>
                  <FormControl>
                    <Input placeholder="Ahmed Mohamed" autoComplete="name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="you@example.com" autoComplete="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="At least 8 characters" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm password</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              <UserPlus /> Create account
            </Button>
          </form>
        </Form>
      </CardContent>
      <CardFooter className="justify-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link to="/login" className="ml-1 font-medium text-primary hover:underline">
          Sign in
        </Link>
      </CardFooter>
    </Card>
  );
}
