import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Mail } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { forgotPasswordSchema } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";

export default function ForgotPasswordPage() {
  const form = useForm<{ email: string }>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = async (values: { email: string }) => {
    const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
      redirectTo: `${window.location.origin}/auth/callback?reset=1`,
    });
    if (error) {
      toast.error(errMsg(error));
      return;
    }
    toast.success("If that email is registered, a recovery link has been sent.");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Reset your password</CardTitle>
        <CardDescription>
          Enter your email and we will send you a secure recovery link.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="you@example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              <Mail /> Send recovery link
            </Button>
          </form>
        </Form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          <Link to="/login" className="hover:underline">
            Back to sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
